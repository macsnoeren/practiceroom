"""One CameraAgent per paired camera: speaks the PracticeRoom device protocol.

It keeps a Socket.IO connection open (authenticated with the device token),
publishes a small preview frame for the control room, and on a recording command
captures with ffmpeg and uploads the segment in chunks — exactly like the
browser camera app, but headless and for one specific camera.
"""

from __future__ import annotations

import base64
import logging
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import socketio

from . import capture
from .config import CameraConfig
from .uploader import ChunkUploader

log = logging.getLogger("practiceroom.agent")

# Socket.IO event names — must match shared/src/index.ts SOCKET_EVENTS.
EV_STATUS_UPDATE = "status:update"
EV_RECORDING_START = "recording:start"
EV_RECORDING_STOP = "recording:stop"
EV_CAMERA_FRAME = "camera:frame"
EV_MIC_SET_GAIN = "mic:set-gain"
EV_MIC_GAIN = "mic:gain"

PREVIEW_EMIT_INTERVAL_S = 2.0


class _CaptureSession:
    """A running recording: ffmpeg → reader thread → chunk uploader."""

    def __init__(self, cmd: list[str], uploader: ChunkUploader, mime_type: str,
                 has_video: bool, has_audio: bool) -> None:
        self._uploader = uploader
        self._mime_type = mime_type
        self._has_video = has_video
        self._has_audio = has_audio
        self._proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        self._reader = threading.Thread(target=self._pump, name="pr-capture-reader", daemon=True)
        self._reader.start()

    def _pump(self) -> None:
        assert self._proc.stdout is not None
        while True:
            data = self._proc.stdout.read(65536)
            if not data:
                break
            self._uploader.feed(data)

    def stop_and_finalize(self) -> bool:
        """Ask ffmpeg to finish cleanly, drain its output, then complete."""
        proc = self._proc
        try:
            if proc.stdin:
                proc.stdin.write(b"q")  # ffmpeg: graceful stop + write trailer
                proc.stdin.flush()
                proc.stdin.close()
        except OSError:
            pass
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.terminate()
        self._reader.join(timeout=10)
        return self._uploader.finish(
            self._mime_type, has_video=self._has_video, has_audio=self._has_audio
        )

    def kill(self) -> None:
        try:
            self._proc.kill()
        except OSError:
            pass


class CameraAgent:
    def __init__(self, cfg: CameraConfig, server_url: str) -> None:
        self._cfg = cfg
        self._server_url = server_url.rstrip("/")
        self._sio = socketio.Client(
            reconnection=True,
            reconnection_delay=3,
            reconnection_attempts=0,  # retry forever
            logger=False,
            engineio_logger=False,
        )
        self._thread: threading.Thread | None = None
        self._stopping = threading.Event()
        self._connected = threading.Event()

        self._lock = threading.RLock()
        self._preview_proc: subprocess.Popen[bytes] | None = None
        self._session: _CaptureSession | None = None
        self._recording_id: str | None = None
        self._recording = False
        self._gain = 1.0
        self._last_error: str | None = None

        # Each camera gets its own preview file so multiple agents don't clash.
        safe = "".join(c if c.isalnum() else "_" for c in cfg.local_id)
        self._preview_path = Path(tempfile.gettempdir()) / f"pr_preview_{safe}.jpg"

        self._register_handlers()
        self._preview_thread = threading.Thread(
            target=self._preview_loop, name="pr-preview", daemon=True
        )

    # -- lifecycle -----------------------------------------------------------

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stopping.clear()
        self._thread = threading.Thread(target=self._run_forever, name="pr-agent", daemon=True)
        self._thread.start()
        self._preview_thread.start()

    def stop(self) -> None:
        self._stopping.set()
        self._stop_capture()
        self._stop_preview_process()
        try:
            self._sio.disconnect()
        except Exception:  # noqa: BLE001 — disconnect is best-effort
            pass

    def status(self) -> dict[str, object]:
        return {
            "local_id": self._cfg.local_id,
            "connected": self._connected.is_set(),
            "recording": self._recording,
            "error": self._last_error,
        }

    # -- connection loop -----------------------------------------------------

    def _run_forever(self) -> None:
        while not self._stopping.is_set():
            try:
                self._sio.connect(
                    self._server_url,
                    auth={"deviceToken": self._cfg.token},
                )
                self._sio.wait()  # blocks until disconnected and not reconnecting
            except Exception as exc:  # noqa: BLE001 — keep retrying on any failure
                msg = str(exc)
                # "Connection error" is socket.io's generic auth-rejection message.
                if "Connection error" in msg:
                    self._last_error = "Verbinding geweigerd door server (token ongeldig? Koppel opnieuw)"
                else:
                    self._last_error = msg
                log.warning("[%s] connect failed: %s", self._cfg.local_id, self._last_error)
                self._stopping.wait(5.0)

    def _register_handlers(self) -> None:
        sio = self._sio

        @sio.event
        def connect() -> None:  # noqa: D401 — socketio handler
            self._connected.set()
            self._last_error = None
            sio.emit(EV_STATUS_UPDATE, {"state": "recording" if self._recording else "idle"})
            if not self._recording:
                self._start_preview_process()

        @sio.event
        def disconnect() -> None:
            self._connected.clear()
            # Free the camera while we have no consumer for its preview.
            if not self._recording:
                self._stop_preview_process()

        @sio.on(EV_RECORDING_START)
        def on_start(payload: dict) -> None:
            recording_id = payload.get("recordingId")
            if recording_id:
                self._begin_recording(str(recording_id))

        @sio.on(EV_RECORDING_STOP)
        def on_stop(_payload: dict) -> None:
            self._end_recording()

        @sio.on(EV_MIC_SET_GAIN)
        def on_gain(payload: dict) -> None:
            try:
                self._gain = max(0.0, min(4.0, float(payload.get("gain", 1.0))))
            except (TypeError, ValueError):
                return
            # Echo back so the control room reflects the applied gain. It takes
            # effect on the next recording (the encoder can't change live).
            if self._connected.is_set():
                self._sio.emit(EV_MIC_GAIN, {"gain": self._gain})

    # -- recording -----------------------------------------------------------

    def _begin_recording(self, recording_id: str) -> None:
        with self._lock:
            if self._session is not None:
                if self._recording_id == recording_id:
                    return  # exact same recording already running
                # Different recording while one is active: finish the old one
                # in the background and fall through to start the new one.
                old_session = self._session
                self._session = None
                self._recording = False
                self._recording_id = None
                threading.Thread(
                    target=lambda: old_session.stop_and_finalize(),
                    name="pr-finalize-prev",
                    daemon=True,
                ).start()
            self._stop_preview_process()
            cmd, has_video, has_audio = capture.build_record_command(
                video_device=self._cfg.video_device,
                audio_device=self._cfg.audio_device,
                wants_video=self._cfg.wants_video,
                wants_audio=self._cfg.wants_audio,
                jpeg_path=str(self._preview_path),
                audio_gain=self._gain,
            )
            mime = "video/x-matroska" if has_video else "audio/x-matroska"
            uploader = ChunkUploader(self._server_url, recording_id, self._cfg.token or "")
            try:
                self._session = _CaptureSession(cmd, uploader, mime, has_video, has_audio)
            except OSError as exc:
                self._last_error = f"ffmpeg start mislukt: {exc}"
                log.error("[%s] %s", self._cfg.local_id, self._last_error)
                self._start_preview_process()
                return
            self._recording = True
            self._recording_id = recording_id
        if self._connected.is_set():
            self._sio.emit(EV_STATUS_UPDATE, {"state": "recording"})

    def _end_recording(self) -> None:
        # Finalising blocks (drains ffmpeg + completes the upload), so do it off
        # the Socket.IO callback thread.
        threading.Thread(target=self._finalize_recording, name="pr-finalize", daemon=True).start()

    def _finalize_recording(self) -> None:
        with self._lock:
            session = self._session
            self._session = None
            self._recording = False
            self._recording_id = None
        if session is not None:
            ok = session.stop_and_finalize()
            if not ok:
                self._last_error = "Upload van segment mislukt"
                log.error("[%s] segment upload failed", self._cfg.local_id)
        if self._connected.is_set():
            self._sio.emit(EV_STATUS_UPDATE, {"state": "idle"})
            self._start_preview_process()

    def _stop_capture(self) -> None:
        with self._lock:
            session = self._session
            self._session = None
            self._recording = False
            self._recording_id = None
        if session is not None:
            session.kill()

    # -- preview -------------------------------------------------------------

    def _start_preview_process(self) -> None:
        if not self._cfg.wants_video or not self._cfg.video_device:
            return
        with self._lock:
            if self._preview_proc is not None or self._session is not None:
                return
            cmd = capture.build_preview_command(self._cfg.video_device, str(self._preview_path))
            try:
                self._preview_proc = subprocess.Popen(
                    cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
            except OSError as exc:
                self._last_error = f"preview start mislukt: {exc}"
                log.error("[%s] %s", self._cfg.local_id, self._last_error)

    def _stop_preview_process(self) -> None:
        with self._lock:
            proc = self._preview_proc
            self._preview_proc = None
        if proc is not None:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                proc.kill()

    def _preview_loop(self) -> None:
        """Emit the latest preview JPEG to the control room while connected."""
        while not self._stopping.is_set():
            self._stopping.wait(PREVIEW_EMIT_INTERVAL_S)
            if self._stopping.is_set():
                break
            if not self._connected.is_set() or not self._cfg.wants_video:
                continue
            try:
                raw = self._preview_path.read_bytes()
            except OSError:
                continue
            if not raw:
                continue
            data_url = "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")
            try:
                self._sio.emit(EV_CAMERA_FRAME, {"dataUrl": data_url})
            except Exception:  # noqa: BLE001 — a failed emit just skips this tick
                continue

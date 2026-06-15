"""One SpeakerAgent per paired speaker: connects with the device token and, on a
`sync:tone` command from the server, plays a tone through an ALSA output. Every
microphone in the room records that tone so the composite worker can align the
independently-started cameras.
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading

import socketio

from .config import SpeakerConfig

log = logging.getLogger("practiceroom.agent")

# Socket.IO event names — must match shared/src/index.ts SOCKET_EVENTS.
EV_STATUS_UPDATE = "status:update"
EV_SYNC_TONE = "sync:tone"

FFMPEG_BIN = os.environ.get("PR_AGENT_FFMPEG", "ffmpeg")
# Mirror of shared SYNC_CHIRP_* (defaults; the server sends the real values).
DEFAULT_START_HZ = 800.0
DEFAULT_END_HZ = 5000.0
DEFAULT_DURATION_S = 0.6
FADE_S = 0.01


class SpeakerAgent:
    def __init__(self, cfg: SpeakerConfig, server_url: str) -> None:
        self._cfg = cfg
        self._server_url = server_url.rstrip("/")
        self._sio = socketio.Client(
            reconnection=True,
            reconnection_delay=3,
            reconnection_attempts=0,
            logger=False,
            engineio_logger=False,
        )
        self._thread: threading.Thread | None = None
        self._stopping = threading.Event()
        self._connected = threading.Event()
        self._last_error: str | None = None
        self._register_handlers()

    # -- lifecycle -----------------------------------------------------------

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stopping.clear()
        self._thread = threading.Thread(target=self._run_forever, name="pr-speaker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stopping.set()
        try:
            self._sio.disconnect()
        except Exception:  # noqa: BLE001 — disconnect is best-effort
            pass

    def status(self) -> dict[str, object]:
        return {
            "local_id": self._cfg.local_id,
            "connected": self._connected.is_set(),
            "recording": False,
            "error": self._last_error,
        }

    # -- connection loop -----------------------------------------------------

    def _run_forever(self) -> None:
        while not self._stopping.is_set():
            try:
                self._sio.connect(self._server_url, auth={"deviceToken": self._cfg.token})
                self._sio.wait()
            except Exception as exc:  # noqa: BLE001 — keep retrying on any failure
                msg = str(exc)
                if "Connection error" in msg:
                    self._last_error = "Verbinding geweigerd door server (token ongeldig? Koppel opnieuw)"
                else:
                    self._last_error = msg
                log.warning("[%s] speaker connect failed: %s", self._cfg.local_id, self._last_error)
                self._stopping.wait(5.0)

    def _register_handlers(self) -> None:
        sio = self._sio

        @sio.event
        def connect() -> None:  # noqa: D401 — socketio handler
            self._connected.set()
            self._last_error = None
            sio.emit(EV_STATUS_UPDATE, {"state": "idle"})

        @sio.event
        def disconnect() -> None:
            self._connected.clear()

        @sio.on(EV_SYNC_TONE)
        def on_tone(payload: dict) -> None:
            try:
                start_hz = float(payload.get("startHz", DEFAULT_START_HZ))
                end_hz = float(payload.get("endHz", DEFAULT_END_HZ))
                dur = float(payload.get("durationMs", DEFAULT_DURATION_S * 1000)) / 1000.0
            except (TypeError, ValueError):
                return
            threading.Thread(
                target=self._play_chirp, args=(start_hz, end_hz, dur), name="pr-tone", daemon=True
            ).start()

    # -- playback ------------------------------------------------------------

    def _play_chirp(self, start_hz: float, end_hz: float, duration: float) -> None:
        device = self._cfg.alsa_device or "default"
        fade_out = max(0.0, duration - FADE_S)
        # Linear sweep via aevalsrc: phase = 2*pi*(f0*t + 0.5*rate*t^2). Must match
        # the worker's linear chirp template.
        half_rate = (end_hz - start_hz) / (2 * duration) if duration > 0 else 0.0
        expr = f"sin(2*PI*({start_hz:.3f}*t+{half_rate:.3f}*t*t))"
        cmd = [
            FFMPEG_BIN,
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"aevalsrc={expr}:d={duration:.3f}:s=48000",
            "-af",
            f"afade=t=in:st=0:d={FADE_S},afade=t=out:st={fade_out:.3f}:d={FADE_S}",
            "-f",
            "alsa",
            device,
        ]
        try:
            subprocess.run(cmd, check=False, timeout=duration + 5)
        except (OSError, subprocess.SubprocessError) as exc:
            self._last_error = f"toon afspelen mislukt: {exc}"
            log.error("[%s] %s", self._cfg.local_id, self._last_error)

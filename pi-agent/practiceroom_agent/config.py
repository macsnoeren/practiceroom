"""Persisted agent configuration: the server URL and the per-camera settings.

The config is a single JSON file (location overridable via PR_AGENT_CONFIG).
Each camera is keyed by a stable local id (its device path, preferring the
/dev/v4l/by-id symlink so it survives replugging). Tokens earned by pairing are
stored here so the agent reconnects on its own after a reboot.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path


def config_path() -> Path:
    """Where the config file lives (env override, else next to the project)."""
    env = os.environ.get("PR_AGENT_CONFIG")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".practiceroom-agent" / "config.json"


# How a camera captures, mirroring the browser app's capture modes.
CAPTURE_MODES = ("both", "video", "audio")


@dataclass
class CameraConfig:
    """One configured camera. `token`/`device_id` are filled in after pairing."""

    local_id: str  # stable key (device path or by-id symlink)
    video_device: str = ""  # e.g. /dev/video0 ("" for an audio-only source)
    audio_device: str = ""  # ALSA name, e.g. "plughw:1,0" ("" = no audio)
    mode: str = "both"  # one of CAPTURE_MODES
    label: str = ""  # human label shown on the config page
    token: str | None = None  # device bearer token, set on pairing
    device_id: str | None = None  # server-side device id, set on pairing
    device_name: str | None = None  # server-side device name, set on pairing

    @property
    def paired(self) -> bool:
        return bool(self.token and self.device_id)

    @property
    def wants_video(self) -> bool:
        return self.mode != "audio"

    @property
    def wants_audio(self) -> bool:
        return self.mode != "video"


@dataclass
class SpeakerConfig:
    """One configured speaker (audio output). Plays the room's sync tone on
    command. `token`/`device_id` are filled in after pairing."""

    local_id: str  # stable key (the ALSA output selector, e.g. "default")
    alsa_device: str = ""  # ALSA output ("" = default)
    label: str = ""
    token: str | None = None
    device_id: str | None = None
    device_name: str | None = None

    @property
    def paired(self) -> bool:
        return bool(self.token and self.device_id)


@dataclass
class AgentConfig:
    server_url: str = ""
    cameras: dict[str, CameraConfig] = field(default_factory=dict)
    speakers: dict[str, SpeakerConfig] = field(default_factory=dict)


class ConfigStore:
    """Loads/saves the config and hands out a single in-memory AgentConfig.

    All mutations go through here under a lock so the Flask request threads and
    the agent threads never corrupt the file.
    """

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or config_path()
        self._lock = threading.RLock()
        self._config = self._load()

    # -- loading / saving ----------------------------------------------------

    def _load(self) -> AgentConfig:
        if not self._path.exists():
            return AgentConfig()
        try:
            raw = json.loads(self._path.read_text("utf-8"))
        except (OSError, ValueError):
            return AgentConfig()
        cameras = {
            cid: CameraConfig(**{**cam, "local_id": cid})
            for cid, cam in raw.get("cameras", {}).items()
        }
        speakers = {
            sid: SpeakerConfig(**{**spk, "local_id": sid})
            for sid, spk in raw.get("speakers", {}).items()
        }
        return AgentConfig(
            server_url=raw.get("server_url", ""), cameras=cameras, speakers=speakers
        )

    def _save_locked(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "server_url": self._config.server_url,
            "cameras": {cid: asdict(cam) for cid, cam in self._config.cameras.items()},
            "speakers": {sid: asdict(spk) for sid, spk in self._config.speakers.items()},
        }
        # Write atomically so a crash mid-write can't truncate the config.
        tmp = self._path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2), "utf-8")
        tmp.replace(self._path)

    # -- accessors -----------------------------------------------------------

    @property
    def server_url(self) -> str:
        with self._lock:
            return self._config.server_url

    def snapshot(self) -> AgentConfig:
        """A deep-ish copy safe to read outside the lock."""
        with self._lock:
            return AgentConfig(
                server_url=self._config.server_url,
                cameras={cid: CameraConfig(**asdict(cam)) for cid, cam in self._config.cameras.items()},
                speakers={sid: SpeakerConfig(**asdict(spk)) for sid, spk in self._config.speakers.items()},
            )

    def get_camera(self, local_id: str) -> CameraConfig | None:
        with self._lock:
            cam = self._config.cameras.get(local_id)
            return CameraConfig(**asdict(cam)) if cam else None

    def get_speaker(self, local_id: str) -> SpeakerConfig | None:
        with self._lock:
            spk = self._config.speakers.get(local_id)
            return SpeakerConfig(**asdict(spk)) if spk else None

    # -- mutations -----------------------------------------------------------

    def set_server_url(self, url: str) -> None:
        with self._lock:
            self._config.server_url = url.strip().rstrip("/")
            self._save_locked()

    def upsert_camera(self, cam: CameraConfig) -> None:
        with self._lock:
            self._config.cameras[cam.local_id] = cam
            self._save_locked()

    def update_camera(self, local_id: str, **changes: object) -> CameraConfig | None:
        with self._lock:
            cam = self._config.cameras.get(local_id)
            if not cam:
                return None
            for key, value in changes.items():
                setattr(cam, key, value)
            self._save_locked()
            return CameraConfig(**asdict(cam))

    def remove_camera(self, local_id: str) -> None:
        with self._lock:
            self._config.cameras.pop(local_id, None)
            self._save_locked()

    # -- speaker mutations ---------------------------------------------------

    def upsert_speaker(self, spk: SpeakerConfig) -> None:
        with self._lock:
            self._config.speakers[spk.local_id] = spk
            self._save_locked()

    def update_speaker(self, local_id: str, **changes: object) -> SpeakerConfig | None:
        with self._lock:
            spk = self._config.speakers.get(local_id)
            if not spk:
                return None
            for key, value in changes.items():
                setattr(spk, key, value)
            self._save_locked()
            return SpeakerConfig(**asdict(spk))

    def remove_speaker(self, local_id: str) -> None:
        with self._lock:
            self._config.speakers.pop(local_id, None)
            self._save_locked()

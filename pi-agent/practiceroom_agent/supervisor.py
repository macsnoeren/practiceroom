"""Ties everything together: pairing, per-camera agents and live status.

The Flask UI talks only to this Supervisor; it never touches agents directly.
"""

from __future__ import annotations

import logging
import threading

import requests

from . import discovery
from .camera_agent import CameraAgent
from .config import CAPTURE_MODES, CameraConfig, ConfigStore

log = logging.getLogger("practiceroom.supervisor")


class PairError(Exception):
    """Raised when pairing with the server fails (bad code, no server, …)."""


class Supervisor:
    def __init__(self, store: ConfigStore) -> None:
        self._store = store
        self._agents: dict[str, CameraAgent] = {}
        self._lock = threading.RLock()

    # -- startup -------------------------------------------------------------

    def start(self) -> None:
        """Bring up an agent for every already-paired camera."""
        cfg = self._store.snapshot()
        if not cfg.server_url:
            return
        for cam in cfg.cameras.values():
            if cam.paired:
                self._ensure_agent(cam, cfg.server_url)

    def stop(self) -> None:
        with self._lock:
            for agent in self._agents.values():
                agent.stop()
            self._agents.clear()

    # -- server URL ----------------------------------------------------------

    def set_server_url(self, url: str) -> None:
        self._store.set_server_url(url)
        # Reconnect every agent against the new server.
        self._restart_all()

    @property
    def server_url(self) -> str:
        return self._store.server_url

    # -- camera configuration ------------------------------------------------

    def configure_camera(
        self, local_id: str, *, video_device: str, audio_device: str, mode: str, label: str
    ) -> None:
        if mode not in CAPTURE_MODES:
            mode = "both"
        existing = self._store.get_camera(local_id)
        cam = existing or CameraConfig(local_id=local_id)
        cam.video_device = video_device
        cam.audio_device = audio_device
        cam.mode = mode
        cam.label = label
        self._store.upsert_camera(cam)
        # If it's already paired and running, restart so changes take effect.
        if cam.paired:
            self._restart_camera(local_id)

    def pair_camera(self, local_id: str, pairing_code: str) -> CameraConfig:
        server_url = self._store.server_url
        if not server_url:
            raise PairError("Stel eerst de server-URL in.")
        cam = self._store.get_camera(local_id)
        if not cam:
            raise PairError("Camera is nog niet geconfigureerd.")

        try:
            res = requests.post(
                f"{server_url}/api/devices/pair",
                json={"pairingCode": pairing_code.strip()},
                timeout=15,
            )
        except requests.RequestException as exc:
            raise PairError(f"Kon de server niet bereiken: {exc}") from exc

        if not res.ok:
            msg = _error_message(res) or "Koppelen mislukt."
            raise PairError(msg)

        body = res.json()
        device = body.get("device", {})
        updated = self._store.update_camera(
            local_id,
            token=body.get("token"),
            device_id=device.get("id"),
            device_name=device.get("name"),
        )
        if not updated:
            raise PairError("Camera verdween tijdens het koppelen.")
        self._ensure_agent(updated, server_url)
        return updated

    def unpair_camera(self, local_id: str) -> None:
        self._stop_agent(local_id)
        self._store.update_camera(local_id, token=None, device_id=None, device_name=None)

    def remove_camera(self, local_id: str) -> None:
        self._stop_agent(local_id)
        self._store.remove_camera(local_id)

    # -- views for the UI ----------------------------------------------------

    def list_sources(self) -> list[dict[str, object]]:
        """Detected cameras merged with their config and live status."""
        cfg = self._store.snapshot()
        video_devices = discovery.list_video_devices()
        seen: set[str] = set()
        sources: list[dict[str, object]] = []

        for dev in video_devices:
            seen.add(dev.path)
            cam = cfg.cameras.get(dev.path)
            sources.append(self._source_view(dev.path, dev.name, cam))

        # Also show configured cameras whose device isn't currently detected
        # (e.g. unplugged), so the user can still see/unpair them.
        for local_id, cam in cfg.cameras.items():
            if local_id not in seen:
                sources.append(self._source_view(local_id, cam.label or local_id, cam, present=False))

        return sources

    def _source_view(
        self, local_id: str, detected_name: str, cam: CameraConfig | None, present: bool = True
    ) -> dict[str, object]:
        status = self._agent_status(local_id)
        return {
            "local_id": local_id,
            "detected_name": detected_name,
            "present": present,
            "configured": cam is not None,
            "video_device": cam.video_device if cam else local_id,
            "audio_device": cam.audio_device if cam else "",
            "mode": cam.mode if cam else "both",
            "label": cam.label if cam else "",
            "paired": cam.paired if cam else False,
            "device_name": cam.device_name if cam else None,
            "connected": status.get("connected", False),
            "recording": status.get("recording", False),
            "error": status.get("error"),
        }

    def list_audio_devices(self) -> list[dict[str, str]]:
        return [{"alsa": d.alsa, "name": d.name} for d in discovery.list_audio_devices()]

    # -- agent management ----------------------------------------------------

    def _ensure_agent(self, cam: CameraConfig, server_url: str) -> None:
        with self._lock:
            if cam.local_id in self._agents:
                return
            agent = CameraAgent(cam, server_url)
            self._agents[cam.local_id] = agent
            agent.start()
            log.info("started agent for %s", cam.local_id)

    def _stop_agent(self, local_id: str) -> None:
        with self._lock:
            agent = self._agents.pop(local_id, None)
        if agent:
            agent.stop()

    def _restart_camera(self, local_id: str) -> None:
        self._stop_agent(local_id)
        cam = self._store.get_camera(local_id)
        if cam and cam.paired and self._store.server_url:
            self._ensure_agent(cam, self._store.server_url)

    def _restart_all(self) -> None:
        cfg = self._store.snapshot()
        with self._lock:
            for agent in self._agents.values():
                agent.stop()
            self._agents.clear()
        if cfg.server_url:
            for cam in cfg.cameras.values():
                if cam.paired:
                    self._ensure_agent(cam, cfg.server_url)

    def _agent_status(self, local_id: str) -> dict[str, object]:
        with self._lock:
            agent = self._agents.get(local_id)
        return agent.status() if agent else {}


def _error_message(res: requests.Response) -> str | None:
    try:
        data = res.json()
    except ValueError:
        return None
    return data.get("error") if isinstance(data, dict) else None

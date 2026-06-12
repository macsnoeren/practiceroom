"""Discover the cameras and microphones attached to the Pi.

Best-effort and defensive: on a non-Linux dev machine (or when v4l-utils isn't
installed) the helpers simply return what they can, so the rest of the app and
the config page keep working.
"""

from __future__ import annotations

import glob
import os
import re
import subprocess
from dataclasses import dataclass


@dataclass
class VideoDevice:
    path: str  # the device path to hand to ffmpeg (prefer a stable by-id link)
    name: str  # human-friendly name for the config page


@dataclass
class AudioDevice:
    alsa: str  # ffmpeg ALSA selector, e.g. "plughw:1,0"
    name: str


def _run(cmd: list[str]) -> str:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=5, check=False)
        return out.stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _fake_count() -> int:
    """Number of synthetic test cameras to expose (PR_AGENT_FAKE), else 0."""
    raw = os.environ.get("PR_AGENT_FAKE", "")
    if not raw:
        return 0
    return int(raw) if raw.isdigit() else 1


def list_video_devices() -> list[VideoDevice]:
    """List capture cameras, preferring stable /dev/v4l/by-id/* paths.

    `v4l2-ctl --list-devices` groups nodes by hardware and gives a readable
    name; we map each to its first /dev/video node. Falls back to a plain glob.
    With PR_AGENT_FAKE set, returns synthetic test cameras (no hardware needed).
    """
    fake = _fake_count()
    if fake:
        return [VideoDevice(path=f"test:{i}", name=f"Testcamera {i + 1}") for i in range(fake)]

    devices: list[VideoDevice] = []
    by_id = {os.path.realpath(p): p for p in glob.glob("/dev/v4l/by-id/*")}

    listing = _run(["v4l2-ctl", "--list-devices"])
    if listing:
        current_name = ""
        for line in listing.splitlines():
            if not line.strip():
                continue
            if not line.startswith("\t") and not line.startswith(" "):
                current_name = line.strip().rstrip(":")
                continue
            node = line.strip()
            if not node.startswith("/dev/video"):
                continue
            # Only the first /dev/video node of a camera is the capture node we
            # want; skip metadata nodes (usually higher-numbered, non-capturing).
            if any(d.name == current_name for d in devices):
                continue
            stable = by_id.get(os.path.realpath(node), node)
            devices.append(VideoDevice(path=stable, name=current_name or node))

    if not devices:
        for node in sorted(glob.glob("/dev/video*")):
            stable = by_id.get(os.path.realpath(node), node)
            devices.append(VideoDevice(path=stable, name=node))

    return devices


def list_audio_devices() -> list[AudioDevice]:
    """List ALSA capture devices via `arecord -l` (or a synthetic test mic)."""
    if _fake_count():
        return [AudioDevice(alsa="test:0", name="Testmicrofoon")]

    devices: list[AudioDevice] = []
    listing = _run(["arecord", "-l"])
    # Lines look like: "card 1: U0x46d0x825 [..], device 0: USB Audio [USB Audio]"
    pattern = re.compile(r"card (\d+): (\S+).*?device (\d+): (.+?)(?:\s*\[|$)")
    for line in listing.splitlines():
        m = pattern.search(line)
        if not m:
            continue
        card, card_name, device, dev_name = m.group(1), m.group(2), m.group(3), m.group(4)
        devices.append(
            AudioDevice(alsa=f"plughw:{card},{device}", name=f"{card_name} — {dev_name.strip()}")
        )
    return devices

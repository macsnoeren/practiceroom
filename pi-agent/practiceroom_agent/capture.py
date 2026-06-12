"""ffmpeg command construction for preview frames and lesson recordings.

Only one process may hold a V4L2 camera at a time, so the agent runs *either* a
low-rate preview process (when idle) *or* a recording process that also emits
preview frames (while recording) — never both at once. The recording is written
to stdout as a streamable Matroska so the chunk uploader can read it piece by
piece; the composite worker on the server re-encodes everything anyway, so the
exact codec here only needs to be something ffmpeg can read back.
"""

from __future__ import annotations

import os

# A small JPEG preview, matching the browser app (≈320px wide, ~1 fps).
PREVIEW_WIDTH = 320
PREVIEW_FPS = 1
PREVIEW_QUALITY = 8  # ffmpeg -q:v (2=best … 31=worst)

# Video encoder. On a Pi 4/5 the hardware encoder "h264_v4l2m2m" is far lighter;
# override with PR_AGENT_VENC=h264_v4l2m2m. Default is the universally-available
# software encoder tuned for low CPU.
VIDEO_ENCODER = os.environ.get("PR_AGENT_VENC", "libx264")
FFMPEG_BIN = os.environ.get("PR_AGENT_FFMPEG", "ffmpeg")


def ffmpeg_bin() -> str:
    return FFMPEG_BIN


def _video_encode_args() -> list[str]:
    if VIDEO_ENCODER == "libx264":
        return ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-pix_fmt", "yuv420p"]
    # Hardware/other encoders: keep it simple and let the encoder default.
    return ["-c:v", VIDEO_ENCODER, "-pix_fmt", "yuv420p"]


def _preview_output(video_input_index: int, jpeg_path: str) -> list[str]:
    """Args for a second output that overwrites a single JPEG at PREVIEW_FPS."""
    return [
        "-map",
        f"{video_input_index}:v:0",
        "-vf",
        f"scale={PREVIEW_WIDTH}:-2",
        "-r",
        str(PREVIEW_FPS),
        "-q:v",
        str(PREVIEW_QUALITY),
        "-update",
        "1",
        "-f",
        "image2",
        "-y",
        jpeg_path,
    ]


def build_preview_command(video_device: str, jpeg_path: str) -> list[str]:
    """ffmpeg that continuously refreshes a single preview JPEG (idle state)."""
    return [
        FFMPEG_BIN,
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "v4l2",
        "-i",
        video_device,
        "-vf",
        f"scale={PREVIEW_WIDTH}:-2",
        "-r",
        str(PREVIEW_FPS),
        "-q:v",
        str(PREVIEW_QUALITY),
        "-update",
        "1",
        "-f",
        "image2",
        "-y",
        jpeg_path,
    ]


def build_record_command(
    *,
    video_device: str,
    audio_device: str,
    wants_video: bool,
    wants_audio: bool,
    jpeg_path: str,
    audio_gain: float = 1.0,
) -> tuple[list[str], bool, bool]:
    """Build the recording ffmpeg command.

    Returns (args, has_video, has_audio). The Matroska stream goes to stdout
    (pipe:1); when a camera is present, a preview JPEG is produced as a second
    output so the control room keeps seeing the picture during recording.
    """
    has_video = wants_video and bool(video_device)
    has_audio = wants_audio and bool(audio_device)

    args: list[str] = [FFMPEG_BIN, "-hide_banner", "-loglevel", "error"]
    video_index = -1
    audio_index = -1
    idx = 0
    if has_video:
        args += ["-f", "v4l2", "-i", video_device]
        video_index = idx
        idx += 1
    if has_audio:
        args += ["-f", "alsa", "-i", audio_device]
        audio_index = idx
        idx += 1

    # Primary output: streamable Matroska to stdout.
    if has_video:
        args += ["-map", f"{video_index}:v:0"] + _video_encode_args() + ["-g", "30"]
    if has_audio:
        args += ["-map", f"{audio_index}:a:0"]
        # Apply the control room's chosen mic gain, if any.
        if abs(audio_gain - 1.0) > 1e-3:
            args += ["-af", f"volume={audio_gain:.3f}"]
        args += ["-c:a", "aac", "-b:a", "128k"]
    args += ["-f", "matroska", "pipe:1"]

    # Secondary output: a live preview JPEG (only when there is a camera).
    if has_video:
        args += _preview_output(video_index, jpeg_path)

    return args, has_video, has_audio

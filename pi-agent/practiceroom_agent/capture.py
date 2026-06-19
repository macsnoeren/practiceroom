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

# Devices whose path starts with this use a synthesised ffmpeg source instead of
# real hardware — handy for testing in Docker without a camera/microphone.
TEST_PREFIX = "test:"


def ffmpeg_bin() -> str:
    return FFMPEG_BIN


# Stamp every incoming packet with the real wall-clock time it arrived, on BOTH
# the camera and the microphone input. This is the linchpin of multi-cam sync:
# the V4L2 camera needs seconds to warm up and deliver its first frame while ALSA
# audio flows immediately, yet each device otherwise timestamps from 0 — hiding
# that real start gap. Without a shared clock the recording LOOKS A/V-aligned but
# the video is silently seconds behind its audio, and because the server detects
# the sync chirp in AUDIO it can never recover that hidden video offset. Wall-clock
# timestamps put audio and video on one timeline so the muxed file is genuinely in
# sync (and stays so through the server's chirp-based trim).
_WALLCLOCK = ["-use_wallclock_as_timestamps", "1"]

# Per-input packet buffers. With two independent live inputs feeding one encoder,
# whichever stream the encoder isn't draining must be buffered or its packets are
# dropped — that shows up as a lower-than-requested video fps and as audio
# crackle/desync. A generous queue (esp. on audio, to ride out ALSA underruns)
# trades a little RAM for clean capture. Overridable for tuning on slow devices.
_VIDEO_QUEUE = os.environ.get("PR_AGENT_VQUEUE", "1024")
_AUDIO_QUEUE = os.environ.get("PR_AGENT_AQUEUE", "4096")

# Optionally pin the camera to an explicit capture mode. Left unset by default
# (ffmpeg negotiates), but if the camera otherwise delivers an odd/low rate
# (e.g. 26.7 fps instead of 30), set PR_AGENT_FRAMERATE=30 and PR_AGENT_VIDEO_SIZE
# =1280x720 to a mode the device actually supports.
_FRAMERATE = os.environ.get("PR_AGENT_FRAMERATE", "")
_VIDEO_SIZE = os.environ.get("PR_AGENT_VIDEO_SIZE", "")


def _video_input(device: str) -> list[str]:
    """ffmpeg input args for a camera (or a synthetic test pattern)."""
    if device.startswith(TEST_PREFIX):
        # -re plays the generated frames at real time, like a live camera would.
        return ["-re", "-f", "lavfi", "-i", "testsrc=size=640x480:rate=15"]
    args = ["-thread_queue_size", _VIDEO_QUEUE, *_WALLCLOCK]
    if _FRAMERATE:
        args += ["-framerate", _FRAMERATE]
    if _VIDEO_SIZE:
        args += ["-video_size", _VIDEO_SIZE]
    return [*args, "-f", "v4l2", "-i", device]


def _audio_input(device: str) -> list[str]:
    """ffmpeg input args for a microphone (or a synthetic test tone)."""
    if device.startswith(TEST_PREFIX):
        return ["-re", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"]
    return ["-thread_queue_size", _AUDIO_QUEUE, *_WALLCLOCK, "-f", "alsa", "-i", device]


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
        *_video_input(video_device),
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
        args += _video_input(video_device)
        video_index = idx
        idx += 1
    if has_audio:
        args += _audio_input(audio_device)
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

# PracticeRoom camera-agent (Raspberry Pi)

A small, headless Python application that turns the camera(s) attached to a
Raspberry Pi into PracticeRoom capture devices. It speaks **exactly the same
protocol** as the browser camera app (pairing → Socket.IO → chunked upload), so
**no changes to the PracticeRoom server are needed**. A local web page does the
configuration (server URL + per-camera pairing).

## How it works

For every camera you configure, the agent:

1. **Pairs** with the server using a one-time code from the dashboard
   (`POST /api/devices/pair`) and stores the device token.
2. Keeps a **Socket.IO** connection open (authenticated with that token) and
   publishes a small preview frame so the camera shows up live in the
   _regiekamer_.
3. On a **record** command, captures with `ffmpeg` (from `/dev/videoN` + an ALSA
   microphone) and **uploads the segment in chunks**; on stop it calls
   `…/complete`. The server's composite worker stitches everything as usual.

Each physical camera becomes its own PracticeRoom device, so you can place
several on one Pi and select them independently in a lesson.

## Requirements

- A Raspberry Pi (or any Linux box) with Python 3.11+.
- System packages:
  ```bash
  sudo apt update
  sudo apt install -y ffmpeg v4l-utils alsa-utils python3-venv
  ```

## Install

```bash
cd pi-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python -m practiceroom_agent
```

Then open the config page on the Pi's address: **http://<pi-ip>:8088**

1. Fill in the **PracticeRoom server-URL** (e.g. `https://lessen.mijnschool.nl`)
   and save.
2. For each detected camera: pick the **mode** (camera+mic / camera only /
   mic only) and microphone, then **Instellingen opslaan**.
3. In the PracticeRoom **dashboard**, add a camera (Camera's → toevoegen) to get
   a **koppelcode**, and enter that code on the agent page to **Koppelen**.

The camera then appears online in the regiekamer and records on command. The
agent reconnects on its own after a reboot.

## Configuration (environment variables)

| Variable          | Default                                  | Purpose                                            |
| ----------------- | ---------------------------------------- | -------------------------------------------------- |
| `PR_AGENT_HOST`   | `0.0.0.0`                                | Bind address of the config page                    |
| `PR_AGENT_PORT`   | `8088`                                   | Port of the config page                            |
| `PR_AGENT_CONFIG` | `~/.practiceroom-agent/config.json`      | Where settings + tokens are stored                 |
| `PR_AGENT_VENC`   | `libx264`                                | ffmpeg video encoder; use `h264_v4l2m2m` on a Pi 4/5 for hardware encoding |
| `PR_AGENT_FFMPEG` | `ffmpeg`                                 | Path to the ffmpeg binary                          |

## Run as a service

See [`practiceroom-agent.service`](practiceroom-agent.service) for a systemd unit
that starts the agent at boot and restarts it on failure.

## Test in Docker (no hardware)

You can exercise the whole pipeline — pairing, preview, recording, chunked
upload, compositing — without a real camera, using ffmpeg's built-in test
source. The root `docker-compose.yml` has an optional `agent` service behind the
`agent` profile that exposes two **synthetic test cameras** (`PR_AGENT_FAKE=2`).

From the repository root, with the normal stack configured (`.env` present):

```bash
docker compose --profile agent up -d --build
```

Then:

1. Open the dashboard at **http://localhost:8080**, log in, and under **Camera's**
   add a camera to get a **koppelcode**.
2. Open the agent page at **http://localhost:8088**. Set the server URL to
   **http://server:3000** (the API container on the compose network) and save.
3. On a test camera: save its settings, then paste the koppelcode and **Koppelen**.
   It turns **Online** and shows a moving test pattern in the regiekamer.
4. Plan a lesson with that camera, start recording from the regiekamer, stop, and
   finish the lesson — the combined video is built from the uploaded test footage.

Build/run the image on its own (just the config page, no server) with:

```bash
docker build -t pr-agent ./pi-agent
docker run --rm -e PR_AGENT_FAKE=2 -p 8088:8088 pr-agent
```

To run synthetic cameras on real hardware too, set `PR_AGENT_FAKE` and skip the
device pass-through; for real cameras, give the container access to the V4L2/ALSA
devices (e.g. `--device /dev/video0`) and leave `PR_AGENT_FAKE` unset.

## Notes & limitations

- Only one process can hold a V4L2 camera at a time, so the agent runs a
  low-rate **preview** process when idle and switches to a **recording** process
  (which also emits preview frames) while recording.
- Recordings are produced as Matroska (H.264/AAC); the server re-encodes when
  building the combined lesson video, so the exact codec here is not critical.
- The control room's **mic gain** is honoured on the next recording (the encoder
  can't change gain mid-stream). The live mic-level meter is not reported by the
  agent.
- This agent has been written against the existing protocol but should be tested
  on real hardware (camera + microphone) before relying on it for a lesson.

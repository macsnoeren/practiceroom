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

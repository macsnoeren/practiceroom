# PracticeRoom camera agent. Build context is this pi-agent/ directory.
# Bundles ffmpeg so it can capture (or, in test mode, synthesise) and upload.
FROM python:3.12-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY practiceroom_agent ./practiceroom_agent

ENV PR_AGENT_PORT=8088
EXPOSE 8088

CMD ["python", "-m", "practiceroom_agent"]

"""Chunked, ordered upload of a recording, mirroring the browser camera app.

Bytes are appended in order; a chunk stays pending until the server confirms it,
so a transient failure (network blip, 429, 5xx) just retries the same chunk. A
permanent rejection (e.g. 4xx other than 429) stops the upload and marks it
failed rather than retrying forever. Each request is kept well under the
server's body limit by flushing in ~1 MB pieces.
"""

from __future__ import annotations

import time
import urllib.parse

import requests

# Flush accumulated bytes once we have at least this much (server caps each
# request; the browser app uses 4 MB slices — we stay well below that).
CHUNK_TARGET_BYTES = 1024 * 1024
RETRY_BACKOFF_S = 1.0


def _is_retryable(status: int) -> bool:
    return status == 429 or status >= 500


class ChunkUploader:
    def __init__(self, server_url: str, recording_id: str, token: str) -> None:
        self._base = server_url.rstrip("/")
        self._recording_id = recording_id
        self._token = token
        self._buffer = bytearray()
        self._index = 0
        self._failed = False
        self._stopped = False

    @property
    def failed(self) -> bool:
        return self._failed

    def feed(self, data: bytes) -> None:
        """Add raw bytes; flush whole chunks as soon as we have enough."""
        if self._failed or self._stopped or not data:
            return
        self._buffer.extend(data)
        while len(self._buffer) >= CHUNK_TARGET_BYTES and not self._failed:
            piece = bytes(self._buffer[:CHUNK_TARGET_BYTES])
            del self._buffer[:CHUNK_TARGET_BYTES]
            self._send_with_retry(piece)

    def finish(
        self,
        mime_type: str,
        *,
        has_video: bool,
        has_audio: bool,
    ) -> bool:
        """Flush any remainder and mark the recording complete. Returns success."""
        self._stopped = True
        if not self._failed and self._buffer:
            piece = bytes(self._buffer)
            self._buffer.clear()
            self._send_with_retry(piece)
        if self._failed:
            return False

        params = urllib.parse.urlencode(
            {
                "mimeType": mime_type,
                "hasVideo": str(has_video).lower(),
                "hasAudio": str(has_audio).lower(),
            }
        )
        url = f"{self._base}/api/recordings/{self._recording_id}/complete?{params}"
        try:
            res = requests.post(url, headers=self._headers(), timeout=30)
            return res.ok
        except requests.RequestException:
            return False

    # -- internals -----------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        return {"authorization": f"Bearer {self._token}"}

    def _send_with_retry(self, piece: bytes) -> None:
        while not self._failed:
            outcome = self._send_once(self._index, piece)
            if outcome == "ok":
                self._index += 1
                return
            if outcome == "fatal":
                self._failed = True
                return
            time.sleep(RETRY_BACKOFF_S)  # transient: back off and retry the same chunk

    def _send_once(self, index: int, piece: bytes) -> str:
        url = f"{self._base}/api/recordings/{self._recording_id}/chunks?index={index}"
        try:
            res = requests.post(
                url,
                headers={**self._headers(), "content-type": "application/octet-stream"},
                data=piece,
                timeout=30,
            )
        except requests.RequestException:
            return "retry"
        if res.ok:
            return "ok"
        return "retry" if _is_retryable(res.status_code) else "fatal"

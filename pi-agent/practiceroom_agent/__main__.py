"""Entry point: start the agents and serve the config page.

Run with:  python -m practiceroom_agent
Environment:
  PR_AGENT_HOST   bind address for the config page (default 0.0.0.0)
  PR_AGENT_PORT   port for the config page (default 8088)
  PR_AGENT_CONFIG path to the config JSON (default ~/.practiceroom-agent/config.json)
  PR_AGENT_VENC   ffmpeg video encoder (default libx264; e.g. h264_v4l2m2m on a Pi)
"""

from __future__ import annotations

import logging
import os

from .config import ConfigStore
from .supervisor import Supervisor
from .webapp import create_app


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )

    store = ConfigStore()
    supervisor = Supervisor(store)
    supervisor.start()

    app = create_app(supervisor)
    host = os.environ.get("PR_AGENT_HOST", "0.0.0.0")
    port = int(os.environ.get("PR_AGENT_PORT", "8088"))
    try:
        # threaded=True so status polls don't block pairing/config posts.
        app.run(host=host, port=port, threaded=True)
    finally:
        supervisor.stop()


if __name__ == "__main__":
    main()

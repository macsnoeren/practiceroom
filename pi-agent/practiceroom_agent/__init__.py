"""PracticeRoom headless camera agent for a Raspberry Pi.

Turns every camera attached to a Pi into a PracticeRoom capture device, using
exactly the same pairing / Socket.IO / chunked-upload protocol as the browser
camera app — no server changes needed. A small Flask page does the on-device
configuration (server URL and per-camera pairing).
"""

__all__ = ["__version__"]
__version__ = "0.1.0"

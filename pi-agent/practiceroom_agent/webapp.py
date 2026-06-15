"""The on-device configuration web page (Flask).

Runs on the Pi (default :8088). It talks only to the Supervisor: set the server
URL, configure each detected camera, and pair/unpair it with a code from the
school dashboard. A tiny poll keeps the connection/recording status live.
"""

from __future__ import annotations

import os

from flask import Flask, flash, jsonify, redirect, render_template, request, session, url_for

from .supervisor import PairError, Supervisor


def create_app(supervisor: Supervisor) -> Flask:
    app = Flask(__name__)
    app.secret_key = os.environ.get("PR_AGENT_SECRET", os.urandom(16).hex())

    @app.get("/")
    def index() -> str:
        conn_result = session.pop("conn_result", None)
        return render_template(
            "index.html",
            server_url=supervisor.server_url,
            sources=supervisor.list_sources(),
            audio_devices=supervisor.list_audio_devices(),
            speakers=supervisor.list_speakers(),
            conn_result=conn_result,
        )

    @app.post("/server")
    def set_server():  # type: ignore[no-untyped-def]
        url = request.form.get("server_url", "")
        supervisor.set_server_url(url)
        result = supervisor.test_connection()
        session["conn_result"] = result
        flash("Server-URL opgeslagen.", "ok")
        return redirect(url_for("index"))

    @app.post("/server/test")
    def test_server():  # type: ignore[no-untyped-def]
        url = request.form.get("server_url", "") or supervisor.server_url
        result = supervisor.test_connection(url)
        session["conn_result"] = result
        return redirect(url_for("index"))

    @app.post("/camera/config")
    def configure():  # type: ignore[no-untyped-def]
        local_id = request.form["local_id"]
        supervisor.configure_camera(
            local_id,
            video_device=request.form.get("video_device", local_id),
            audio_device=request.form.get("audio_device", ""),
            mode=request.form.get("mode", "both"),
            label=request.form.get("label", ""),
        )
        flash("Camera-instellingen opgeslagen.", "ok")
        return redirect(url_for("index"))

    @app.post("/camera/pair")
    def pair():  # type: ignore[no-untyped-def]
        local_id = request.form["local_id"]
        try:
            cam = supervisor.pair_camera(local_id, request.form.get("pairing_code", ""))
            flash(f"Gekoppeld als ‘{cam.device_name}’.", "ok")
        except PairError as exc:
            flash(str(exc), "error")
        return redirect(url_for("index"))

    @app.post("/camera/unpair")
    def unpair():  # type: ignore[no-untyped-def]
        supervisor.unpair_camera(request.form["local_id"])
        flash("Koppeling verbroken.", "ok")
        return redirect(url_for("index"))

    @app.post("/speaker/config")
    def configure_speaker():  # type: ignore[no-untyped-def]
        local_id = request.form["local_id"]
        supervisor.configure_speaker(
            local_id,
            alsa_device=request.form.get("alsa_device", local_id),
            label=request.form.get("label", ""),
        )
        flash("Speaker-instellingen opgeslagen.", "ok")
        return redirect(url_for("index"))

    @app.post("/speaker/pair")
    def pair_speaker():  # type: ignore[no-untyped-def]
        local_id = request.form["local_id"]
        try:
            spk = supervisor.pair_speaker(local_id, request.form.get("pairing_code", ""))
            flash(f"Speaker gekoppeld als ‘{spk.device_name}’.", "ok")
        except PairError as exc:
            flash(str(exc), "error")
        return redirect(url_for("index"))

    @app.post("/speaker/unpair")
    def unpair_speaker():  # type: ignore[no-untyped-def]
        supervisor.unpair_speaker(request.form["local_id"])
        flash("Speaker-koppeling verbroken.", "ok")
        return redirect(url_for("index"))

    @app.get("/api/status")
    def status():  # type: ignore[no-untyped-def]
        merged = {
            s["local_id"]: {
                "paired": s["paired"],
                "connected": s["connected"],
                "recording": s["recording"],
                "present": s["present"],
                "error": s["error"],
            }
            for s in supervisor.list_sources()
        }
        for s in supervisor.list_speakers():
            merged[s["local_id"]] = {
                "paired": s["paired"],
                "connected": s["connected"],
                "recording": False,
                "present": s["present"],
                "error": s["error"],
            }
        return jsonify(merged)

    return app

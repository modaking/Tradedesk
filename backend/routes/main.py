"""
backend/routes/main.py
=======================
Serves the single-page frontend for all non-API routes.
The HTML file is a complete offline SPA — no CDN dependencies.
"""

import os
from flask import Blueprint, send_from_directory, current_app

main_bp = Blueprint("main", __name__)


@main_bp.route("/", defaults={"path": ""})
@main_bp.route("/<path:path>")
def catch_all(path):
    """Serve the SPA index for all frontend routes."""
    frontend_dir = current_app.template_folder
    # If request is for a static asset, serve it directly
    static_candidate = os.path.join(current_app.static_folder, path)
    if path and os.path.isfile(static_candidate):
        return send_from_directory(current_app.static_folder, path)
    # Otherwise serve the SPA shell
    return send_from_directory(frontend_dir, "index.html")

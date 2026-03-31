"""
TradeDesk - Sales & Inventory Dashboard
========================================
Main Flask application factory and entry point.

Architecture:
    User → pywebview Window → Flask API → SQLite DB

Author:  TradeDesk Team
Version: 1.0.0
"""

import os
import sys
import secrets
import logging
from datetime import timedelta
from flask import Flask
from flask_session import Session  # server-side sessions (no cookie secret leakage)

# ── Resolve base paths whether running from source or PyInstaller bundle ──────
if getattr(sys, "frozen", False):
    # Running inside a PyInstaller one-file/one-dir bundle
    BASE_DIR = sys._MEIPASS  # type: ignore[attr-defined]
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
DATABASE_DIR = os.path.join(ROOT_DIR, "database")
LOGS_DIR = os.path.join(ROOT_DIR, "logs")

# Create directories if they don't exist
for d in [DATABASE_DIR, LOGS_DIR]:
    os.makedirs(d, exist_ok=True)


def configure_logging(app: Flask) -> None:
    """Set up rotating file + console logging."""
    from logging.handlers import RotatingFileHandler

    log_path = os.path.join(LOGS_DIR, "tradedesk.log")
    handler = RotatingFileHandler(log_path, maxBytes=5_000_000, backupCount=3)
    handler.setLevel(logging.INFO)
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)

    app.logger.addHandler(handler)
    app.logger.setLevel(logging.INFO)
    logging.getLogger("werkzeug").setLevel(logging.WARNING)  # silence request noise


def create_app() -> Flask:
    """
    Application factory — creates and configures the Flask app.
    Returns a fully configured Flask instance ready to serve.
    """
    app = Flask(
        __name__,
        static_folder=os.path.join(FRONTEND_DIR, "static"),
        template_folder=os.path.join(FRONTEND_DIR, "templates"),
    )

    # ── Security & Session Config ──────────────────────────────────────────────
    # FIX: Never fall back to a hardcoded secret. If TRADEDESK_SECRET is not set,
    # generate a random key and persist it to .secret so it survives restarts.
    secret_key = os.environ.get("TRADEDESK_SECRET")
    if not secret_key:
        secret_file = os.path.join(ROOT_DIR, ".secret")
        if os.path.exists(secret_file):
            with open(secret_file, "r") as f:
                secret_key = f.read().strip()
        if not secret_key:
            secret_key = secrets.token_hex(32)
            with open(secret_file, "w") as f:
                f.write(secret_key)

    app.config.update(
        SECRET_KEY=secret_key,
        SESSION_TYPE="filesystem",
        SESSION_FILE_DIR=os.path.join(ROOT_DIR, ".sessions"),
        SESSION_PERMANENT=False,
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=50 * 1024 * 1024,  # 50 MB max upload
        # Database
        DATABASE_PATH=os.path.join(DATABASE_DIR, "tradedesk.db"),
        # Upload temp folder
        UPLOAD_FOLDER=os.path.join(ROOT_DIR, ".uploads"),
    )

    os.makedirs(app.config["SESSION_FILE_DIR"], exist_ok=True)
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    # ── Server-side Sessions ───────────────────────────────────────────────────
    Session(app)

    # ── Logging ───────────────────────────────────────────────────────────────
    configure_logging(app)

    # ── Database Initialisation ────────────────────────────────────────────────
    from backend.models.database import init_db

    with app.app_context():
        init_db(app.config["DATABASE_PATH"])

    # ── Register Blueprints (route modules) ────────────────────────────────────
    from backend.routes.auth import auth_bp
    from backend.routes.dashboard import dashboard_bp
    from backend.routes.sales import sales_bp
    from backend.routes.products import products_bp
    from backend.routes.inventory import inventory_bp
    from backend.routes.imports import imports_bp
    from backend.routes.reports import reports_bp
    from backend.routes.users import users_bp
    from backend.routes.purchases import purchases_bp
    from backend.routes.audit import audit_bp
    from backend.routes.main import main_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(auth_bp,      url_prefix="/api/auth")
    app.register_blueprint(dashboard_bp, url_prefix="/api/dashboard")
    app.register_blueprint(sales_bp,     url_prefix="/api/sales")
    app.register_blueprint(products_bp,  url_prefix="/api/products")
    app.register_blueprint(inventory_bp, url_prefix="/api/inventory")
    app.register_blueprint(imports_bp,   url_prefix="/api/import")
    app.register_blueprint(reports_bp,   url_prefix="/api/reports")
    app.register_blueprint(users_bp,     url_prefix="/api/users")
    app.register_blueprint(purchases_bp, url_prefix="/api/purchases")
    app.register_blueprint(audit_bp,     url_prefix="/api/audit-log")

    app.logger.info("TradeDesk application started successfully.")
    return app


# ── Development / direct run entry ────────────────────────────────────────────
if __name__ == "__main__":
    application = create_app()
    application.run(host="127.0.0.1", port=5000, debug=False)

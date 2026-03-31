"""
run.py — TradeDesk Desktop Launcher
=====================================
Starts the Flask backend in a background thread and opens the pywebview
window, giving a native desktop-app feel without a visible browser.

Usage:
    python run.py

PyInstaller entry point:
    pyinstaller --onefile --windowed run.py  (see BUILD.md)

Download flow (pywebview mode)
-------------------------------
JS calls window.pywebview.api.save_file(base64Data, suggestedName).
DesktopAPI.save_file() shows a native Save-As dialog, writes the file,
and returns {"ok": true, "path": "..."} or {"ok": false, "error": "..."}.
In browser mode the JS falls back to the standard blob-anchor approach.
"""

import sys
import os
import threading
import logging
import time
import webbrowser

# ── Add project root to path so imports resolve correctly ──────────────────────
ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# ── Configure basic logging before app import ──────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("launcher")

HOST = "127.0.0.1"
PORT = 5000
URL = f"http://{HOST}:{PORT}/"


def find_free_port(start: int = 5000, attempts: int = 20) -> int:
    """Find an open TCP port starting from `start`."""
    import socket
    for port in range(start, start + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex((HOST, port)) != 0:
                return port
    raise RuntimeError("No free port found in range.")


def start_flask(app, host: str, port: int) -> None:
    """Run Flask in a daemon thread (dies when the main process exits)."""
    from werkzeug.serving import make_server

    server = make_server(host, port, app)
    logger.info("Flask server started on %s:%s", host, port)
    server.serve_forever()


def wait_for_server(url: str, timeout: float = 10.0) -> bool:
    """Block until the Flask server responds or timeout expires."""
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


class DesktopAPI:
    """Python methods exposed to JavaScript via window.pywebview.api.*

    All public methods are callable from JS as:
        window.pywebview.api.methodName(args...)
    They must return JSON-serialisable values (dict, list, str, bool, None).
    """

    def __init__(self):
        # Injected by main() after the window is created
        self._window = None

    # ── File save dialog ──────────────────────────────────────────────────────
    def save_file(self, b64_data: str, suggested_name: str) -> dict:
        """Show a native Save-As dialog, then write the decoded bytes.

        Parameters (from JS)
        ----------
        b64_data        : base64-encoded file contents (string)
        suggested_name  : default filename shown in the dialog (e.g. "report.xlsx")

        Returns
        -------
        {"ok": True,  "path": "<absolute path>"}   on success
        {"ok": False, "error": "<message>"}         if cancelled or failed
        """
        import base64

        if self._window is None:
            return {"ok": False, "error": "Window reference not set."}

        # Determine a sensible file-type filter from the extension
        ext = os.path.splitext(suggested_name)[1].lower()
        if ext in (".xlsx", ".xls"):
            file_types = ("Excel Files (*.xlsx;*.xls)", "All Files (*.*)")
        elif ext == ".csv":
            file_types = ("CSV Files (*.csv)", "All Files (*.*)")
        elif ext == ".pdf":
            file_types = ("PDF Files (*.pdf)", "All Files (*.*)")
        else:
            file_types = ("All Files (*.*)",)

        home      = os.path.expanduser("~")
        downloads = os.path.join(home, "Downloads")
        start_dir = downloads if os.path.isdir(downloads) else home

        try:
            # create_file_dialog blocks until the user picks a path or cancels.
            # Returns a tuple of selected paths, or None if cancelled.
            import webview
            result = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                directory=start_dir,
                save_filename=suggested_name,
                file_types=file_types,
            )
        except Exception as exc:
            logger.error("create_file_dialog error: %s", exc)
            return {"ok": False, "error": str(exc)}

        # User cancelled
        if not result:
            return {"ok": False, "error": "cancelled"}

        # result is a tuple; first element is the chosen path
        save_path = result[0] if isinstance(result, (list, tuple)) else result

        # Ensure the extension is preserved (some OS dialogs strip it)
        if ext and not save_path.lower().endswith(ext):
            save_path += ext

        try:
            raw = base64.b64decode(b64_data)
            with open(save_path, "wb") as fh:
                fh.write(raw)
            logger.info("File saved: %s (%d bytes)", save_path, len(raw))
            return {"ok": True, "path": save_path}
        except Exception as exc:
            logger.error("File write error: %s", exc)
            return {"ok": False, "error": str(exc)}


def main():
    from backend.app import create_app

    global PORT
    PORT = find_free_port(5000)
    APP_URL = f"http://{HOST}:{PORT}/"

    app = create_app()

    # Start Flask in background thread
    flask_thread = threading.Thread(
        target=start_flask, args=(app, HOST, PORT), daemon=True
    )
    flask_thread.start()

    # Wait for server readiness
    if not wait_for_server(APP_URL, timeout=15):
        logger.error("Flask server did not start within timeout — aborting.")
        sys.exit(1)

    logger.info("Server ready at %s", APP_URL)

    # ── Try pywebview first; fall back to system browser ──────────────────────
    try:
        import webview  # pywebview

        desktop_api = DesktopAPI()

        window = webview.create_window(
            title="TradeDesk — Sales & Inventory",
            url=APP_URL,
            width=1280,
            height=800,
            min_size=(900, 600),
            resizable=True,
            text_select=True,
            js_api=desktop_api,       # exposes desktop_api as window.pywebview.api
        )

        # Give DesktopAPI a reference to the window so it can open dialogs
        desktop_api._window = window

        # Start GUI event loop (blocks until window closed)
        webview.start(debug=False)

    except ImportError:
        logger.warning("pywebview not installed — opening in default browser instead.")
        webbrowser.open(APP_URL)
        # Keep the Flask server alive until Ctrl+C
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Shutdown requested.")

    logger.info("TradeDesk exited cleanly.")


if __name__ == "__main__":
    main()

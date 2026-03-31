# tradedesk.spec
# ================
# PyInstaller build specification for TradeDesk.
# Supports Windows, Linux, macOS.
#
# Usage:
#   pyinstaller tradedesk.spec
#
# Output:
#   dist/TradeDesk           (Linux / macOS binary)
#   dist/TradeDesk.exe       (Windows)
#   dist/TradeDesk.app/      (macOS .app bundle — set bundle_identifier)

import sys
import os

block_cipher = None

# ── Detect platform-specific icon ─────────────────────────────────────────────
if sys.platform == "win32":
    ICON = "tradedesk.ico" if os.path.exists("tradedesk.ico") else None
elif sys.platform == "darwin":
    ICON = "tradedesk.icns" if os.path.exists("tradedesk.icns") else None
else:
    ICON = "tradedesk.png" if os.path.exists("tradedesk.png") else None

# ── Analysis ──────────────────────────────────────────────────────────────────
a = Analysis(
    ["run.py"],
    pathex=["."],
    binaries=[],
    datas=[
        # Bundle the entire frontend directory (HTML, CSS, JS, libs)
        ("frontend", "frontend"),
        # Bundle backend package (routes, models, services)
        ("backend",  "backend"),
        # Bundle database directory (empty on first run; DB created at runtime)
        ("database", "database"),
    ],
    hiddenimports=[
        # Flask ecosystem
        "flask",
        "flask_session",
        "werkzeug",
        "werkzeug.serving",
        "werkzeug.middleware",
        "jinja2",
        "click",
        "itsdangerous",
        # Security
        "bcrypt",
        # Data
        "pandas",
        "pandas._libs",
        "pandas._libs.tslibs",
        "openpyxl",
        "openpyxl.styles",
        "openpyxl.utils",
        "xlrd",
        # Desktop window
        "webview",
        "webview.platforms",
        # Python stdlib used at runtime
        "sqlite3",
        "json",
        "uuid",
        "tempfile",
        "threading",
        "logging.handlers",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Strip unused heavy packages to keep binary smaller
        "matplotlib",
        "scipy",
        "sklearn",
        "PIL",
        "cv2",
        "torch",
        "tensorflow",
        "notebook",
        "IPython",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# ── Executable ────────────────────────────────────────────────────────────────
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="TradeDesk",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,              # Compress with UPX if available (smaller binary)
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,         # No console window (windowed/GUI mode)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON,
)

# ── macOS .app Bundle ─────────────────────────────────────────────────────────
if sys.platform == "darwin":
    app = BUNDLE(
        exe,
        name="TradeDesk.app",
        icon=ICON,
        bundle_identifier="com.tradedesk.app",
        info_plist={
            "NSHighResolutionCapable": True,
            "CFBundleShortVersionString": "1.0.0",
            "CFBundleVersion": "1",
            "NSRequiresAquaSystemAppearance": False,  # Support Dark Mode
        },
    )

# TradeDesk — Sales & Inventory Dashboard
## Complete Documentation

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Project Structure](#3-project-structure)
4. [Quick Start](#4-quick-start)
5. [Installation](#5-installation)
6. [Running the Application](#6-running-the-application)
7. [Packaging (PyInstaller)](#7-packaging-pyinstaller)
8. [Feature Guide](#8-feature-guide)
9. [API Reference](#9-api-reference)
10. [Database Schema](#10-database-schema)
11. [Excel Import Format](#11-excel-import-format)
12. [Security](#12-security)
13. [Troubleshooting](#13-troubleshooting)
14. [Extending the App](#14-extending-the-app)

---

## 1. Overview

**TradeDesk** is a fully offline desktop application for small-to-medium business sales
and inventory management. It runs entirely on your local machine — no internet connection,
no cloud account, no subscription.

**Key features:**
- 📊 Live dashboard with KPI cards and Chart.js charts
- 🛒 Sales records with full CRUD and filtering
- 📦 Inventory tracking with stock-level indicators
- 🗂️ Product catalogue management
- 📥 Excel bulk import with conflict handling and failed-record reporting
- 📋 Downloadable Excel templates for each import type
- 📈 Analytics: 8 chart types across Sales and Inventory pages
- 🔐 Login system with bcrypt hashing and three role levels (Admin / Staff / Viewer)
- 🌙 Dark mode toggle (placed in the topbar header)
- 💻 Works as a native desktop window (pywebview) or in any browser

---

## 2. Architecture

```
User
 └─ pywebview Window (native desktop)
     └─ HTTP requests to localhost:5000
         └─ Flask API (Python)
             ├─ SQLite Database  (database/tradedesk.db)
             ├─ Session store    (.sessions/)
             └─ Upload temp dir  (.uploads/)
```

- **Frontend**: single HTML file + CSS + vanilla JS — zero framework, zero build step
- **Backend**: Flask blueprints, one per domain (auth, sales, products, inventory, …)
- **Database**: SQLite with WAL mode, parameterised queries only (no SQL injection risk)
- **Charts**: Chart.js 4.4 served from `frontend/static/libs/` — completely offline
- **Auth**: bcrypt (cost 12), server-side filesystem sessions (Flask-Session)

---

## 3. Project Structure

```
tradedesk/
├── run.py                          # Desktop launcher — Flask + pywebview
├── requirements.txt                # Python dependencies
├── install_and_build.bat           # Windows: one-click install + build
├── build.sh                        # Linux / macOS: install + build
├── tradedesk.spec                  # PyInstaller spec (all platforms)
├── README.md                       # This file
│
├── backend/
│   ├── __init__.py
│   ├── app.py                      # Flask factory, blueprint registration
│   ├── models/
│   │   ├── __init__.py
│   │   └── database.py             # SQLite schema, connection helper
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── auth.py                 # /api/auth/*
│   │   ├── dashboard.py            # /api/dashboard/*
│   │   ├── sales.py                # /api/sales/*
│   │   ├── products.py             # /api/products/*
│   │   ├── inventory.py            # /api/inventory/*
│   │   ├── purchases.py            # /api/purchases/*
│   │   ├── imports.py              # /api/import/*
│   │   ├── reports.py              # /api/reports/*
│   │   ├── users.py                # /api/users/*
│   │   └── main.py                 # SPA catch-all
│   └── services/
│       ├── __init__.py
│       └── helpers.py              # require_auth(), sanitizers, pagination
│
├── frontend/
│   ├── templates/
│   │   └── index.html              # Single-Page Application shell
│   └── static/
│       ├── css/
│       │   └── style.css           # Full theme (light + dark)
│       ├── js/
│       │   ├── api.js              # fetch() wrapper + UI helpers
│       │   └── app.js              # Page logic, charts, navigation
│       └── libs/
│           └── chart.umd.min.js    # Chart.js 4.4 (local copy — offline)
│
├── database/                       # SQLite DB created here on first run
├── logs/                           # Rotating log files
├── .sessions/                      # Flask server-side sessions
└── .uploads/                       # Temporary upload staging area
```

---

## 4. Quick Start

### Prerequisites
- Python 3.9 or newer
- pip

### 30-second startup (development mode)

```bash
# 1. Clone / download the project
cd tradedesk

# 2. Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate      # Linux / macOS
# .venv\Scripts\activate       # Windows

# 3. Install dependencies
pip install -r requirements.txt

# 4. Create Python package markers
touch backend/__init__.py backend/routes/__init__.py
touch backend/models/__init__.py backend/services/__init__.py

# 5. Download Chart.js locally (one-time, requires internet)
mkdir -p frontend/static/libs
curl -o frontend/static/libs/chart.umd.min.js \
     https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js

# 6. Launch
python run.py
```

The application opens in a pywebview window. If pywebview is unavailable it
opens in your default browser at http://127.0.0.1:5000.

**Default credentials:** `admin` / `admin123` — change immediately after first login.

---

## 5. Installation

### Windows (one command)

```
install_and_build.bat
```

Double-click the file. It creates the venv, installs packages, downloads
Chart.js, and builds `dist/TradeDesk.exe`.

### Linux / macOS

```bash
chmod +x build.sh
./build.sh
```

---

## 6. Running the Application

### Development (recommended for customisation)

```bash
source .venv/bin/activate
python run.py
```

Flask restarts are NOT automatic in this mode (no debug=True). Edit code and
restart manually.

### Built executable

```
dist/TradeDesk.exe         # Windows
./dist/TradeDesk           # Linux
open dist/TradeDesk.app    # macOS
```

The executable is self-contained. Move `dist/TradeDesk` to any computer
(same OS, no Python required) and it runs offline.

---

## 7. Packaging (PyInstaller)

### Using the spec file (recommended)

```bash
source .venv/bin/activate
pyinstaller tradedesk.spec
```

### Manual one-liner (Windows)

```cmd
pyinstaller --onefile --windowed --name TradeDesk ^
    --add-data "frontend;frontend" --add-data "backend;backend" ^
    --hidden-import flask_session --hidden-import bcrypt ^
    --hidden-import pandas --hidden-import openpyxl run.py
```

### Manual one-liner (Linux / macOS)

```bash
pyinstaller --onefile --windowed --name TradeDesk \
    --add-data "frontend:frontend" --add-data "backend:backend" \
    --hidden-import flask_session --hidden-import bcrypt \
    --hidden-import pandas --hidden-import openpyxl run.py
```

**Note:** Use `;` as the data separator on Windows and `:` on Linux/macOS.

### Output

| Platform | Output |
|---|---|
| Windows | `dist/TradeDesk.exe` |
| Linux | `dist/TradeDesk` |
| macOS | `dist/TradeDesk.app` (with spec) or `dist/TradeDesk` |

---

## 8. Feature Guide

### Dashboard

Shows KPI cards (revenue this month, orders, low stock count, unique customers),
a 14-day sales trend line chart, stock levels bar chart, recent sales list,
and recent import event log.

### Sales

Full table with search, status filter chips, sort by column, inline edit/delete,
and paginated results. Use the **Add Sale** button (topbar or within page) to
create records manually.

### Inventory

Displays all active products with current stock, reorder points, a colour-coded
stock bar (green/amber/red), total value, and status badges. The **Adjust Stock**
button opens a modal to add or remove units with a note for the movement log.

Filter chips: All / In Stock / Low Stock / Out of Stock.

### Products

Full product catalogue. Supports search and category filter. Add Product modal
includes initial stock quantity. Deleting a product soft-deletes (sets
`is_active=0`) — sales history is preserved.

### Excel Import

#### Toggle between Manual and Bulk modes:

**Manual Entry** — form validates all required fields before sending to API.

**Bulk Upload** — select import type (Sales / Inventory / Products), then drag &
drop or browse for `.xlsx` / `.xls`. The pipeline:

1. Parses and normalises column names (case-insensitive, spaces → underscores)
2. Rejects file if mandatory columns are missing (shows error message)
3. Processes each row independently — failures do not stop the batch
4. Skipped rows appear in the **Failed Records** table with row number and reason
5. Results summary: total / success / failed

**Download Templates** — click to download pre-formatted `.xlsx` files with
sample data for each import type.

### Reports

Four charts loaded from live database aggregations:
- Monthly Revenue (bar) — last 12 months
- Sales by Category (doughnut) — current month
- Top Selling Products (horizontal bar) — by quantity, all time
- Inventory Value by Category (doughnut) — at cost price

### User Management (Admin only)

List all users, create new users, set roles (Admin / Staff / Viewer),
deactivate accounts. Deactivation is soft (sets `is_active=0`).

---

## 9. API Reference

All endpoints require an active session (login first via `POST /api/auth/login`).
Role requirements noted where applicable.

### Auth

| Method | Path | Body / Params | Response |
|---|---|---|---|
| POST | `/api/auth/login` | `{username, password}` | `{success, username, role}` |
| POST | `/api/auth/logout` | — | `{success}` |
| GET  | `/api/auth/me` | — | `{authenticated, username, role}` |
| POST | `/api/auth/change-password` | `{old_password, new_password}` | `{success}` |

### Sales

| Method | Path | Notes |
|---|---|---|
| GET | `/api/sales/?page&per_page&search&status&from_date&to_date` | Paginated |
| POST | `/api/sales/` | Staff+ |
| GET | `/api/sales/<id>` | |
| PUT | `/api/sales/<id>` | Staff+ |
| DELETE | `/api/sales/<id>` | Admin |

### Products

| Method | Path | Notes |
|---|---|---|
| GET | `/api/products/?search&category&active_only` | |
| POST | `/api/products/` | Staff+ |
| GET | `/api/products/<id>` | |
| PUT | `/api/products/<id>` | Staff+ |
| DELETE | `/api/products/<id>` | Admin (soft delete) |

### Inventory

| Method | Path | Notes |
|---|---|---|
| GET | `/api/inventory/?search&status` | `status`: in_stock, low_stock, out_of_stock |
| POST | `/api/inventory/adjust` | `{product_id, delta, note}` Staff+ |
| GET | `/api/inventory/low-stock` | Items at or below reorder point |
| GET | `/api/inventory/movements` | Movement history |

### Import

| Method | Path | Notes |
|---|---|---|
| POST | `/api/import/upload` | multipart: `file`, `import_type` |
| GET | `/api/import/template/<type>` | Returns `.xlsx` file |
| GET | `/api/import/logs` | Last 50 imports |
| GET | `/api/import/failed/<log_id>` | Failed rows for an import |

### Reports (all GET)

| Path | Description |
|---|---|
| `/api/reports/daily-sales?days=14` | Revenue per day |
| `/api/reports/monthly-revenue` | Last 12 months revenue |
| `/api/reports/sales-by-product` | Top 10 products by revenue |
| `/api/reports/sales-by-category` | Revenue by category |
| `/api/reports/stock-levels` | Stock per category |
| `/api/reports/top-selling` | Top 10 by quantity |
| `/api/reports/inventory-value` | Value per category |

---

## 10. Database Schema

All tables use `INTEGER PRIMARY KEY AUTOINCREMENT` and are linked with
foreign keys (enforced via `PRAGMA foreign_keys=ON`).

```
users                    products
  id                       id
  username (UNIQUE)        sku (UNIQUE)
  email (UNIQUE)           name
  password_hash            category
  role                     sell_price
  is_active                cost_price
  created_at               reorder_point
  last_login               is_active
                           created_at / updated_at

inventory                sales
  id                       id
  product_id (FK)          reference (UNIQUE)
  quantity                 product_id (FK)
  location                 quantity
  updated_at               unit_price
                           total_amount (GENERATED)
purchases                  customer_name
  id                       payment_method
  reference (UNIQUE)       salesperson
  product_id (FK)          status
  quantity                 sale_date
  unit_cost                created_at / created_by
  supplier
  status                 inventory_movements
  order_date               id
  received_date            product_id (FK)
  created_by               movement_type
                           quantity_delta
excel_import_logs          reference_id
  id                       note
  filename                 moved_at / moved_by
  import_type
  total/success/failed   failed_import_records
  status                   id
  imported_at              import_log_id (FK)
  imported_by              row_number
                           failure_reason
                           raw_data (JSON string)
```

---

## 11. Excel Import Format

### Sales Template

| Column | Required | Notes |
|---|---|---|
| date | ✓ | YYYY-MM-DD or any parseable format |
| product_name | ✓ | Must match a product name exactly |
| quantity | ✓ | Positive integer |
| price | ✓ | Unit price, positive number |
| customer_name | — | Optional |
| payment_method | — | Default: Cash |
| salesperson | — | Optional |

### Inventory Template

| Column | Required | Notes |
|---|---|---|
| sku | ✓ | Must match existing product SKU |
| quantity | ✓ | New quantity level |
| location | — | Default: Main Warehouse |

### Products Template

| Column | Required | Notes |
|---|---|---|
| name | ✓ | Product display name |
| sell_price | ✓ | Selling price |
| cost_price | — | Default 0 |
| category | — | Default: General |
| reorder_point | — | Default 10 |
| sku | — | Auto-generated if blank |

**Conflict handling:** duplicate rows are skipped, not crashed. Each skipped
row appears in the Failed Records table with a plain-English reason.

---

## 12. Security

| Measure | Implementation |
|---|---|
| Password hashing | bcrypt with cost factor 12 |
| Session management | Flask-Session (server-side filesystem) |
| SQL injection prevention | Parameterised queries everywhere — no string interpolation |
| Input sanitisation | `sanitize_str()` strips whitespace, collapses runs, truncates |
| Role-based access | `@require_auth(roles=[...])` decorator on every endpoint |
| CSRF mitigation | SameSite=Lax cookies + credentials: same-origin fetch |
| File upload safety | `secure_filename()`, extension whitelist (.xlsx/.xls only), temp file cleanup |
| Error logging | Rotating file handler in `logs/tradedesk.log` |
| Timing attack prevention | Dummy bcrypt check on unknown usernames |

**Production hardening checklist:**
- [ ] Change `SECRET_KEY` in `app.py` (or set `TRADEDESK_SECRET` env var)
- [ ] Change the default admin password on first login
- [ ] Set `SESSION_COOKIE_SECURE=True` if running over HTTPS
- [ ] Restrict `.sessions/` and `database/` directory permissions

---

## 13. Troubleshooting

### Application won't start

```
ModuleNotFoundError: No module named 'backend'
```
Run from the project root (same directory as `run.py`), not from inside `backend/`.

```
ModuleNotFoundError: No module named 'flask_session'
```
Activate your virtual environment: `source .venv/bin/activate`

### pywebview window is blank / white

- Wait ~3 seconds; Flask may still be starting up.
- Check `logs/tradedesk.log` for Python errors.
- Try opening http://127.0.0.1:5000 in your browser as a fallback.

### Chart.js not rendering

The file `frontend/static/libs/chart.umd.min.js` is missing.
Download it manually:
```bash
curl -o frontend/static/libs/chart.umd.min.js \
     https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js
```

### Excel import fails immediately

- File must be `.xlsx` or `.xls` — `.csv` is not supported.
- The first row must contain column headers.
- Required columns must match exactly (case-insensitive after normalisation).

### Port already in use

The launcher tries ports 5000–5019 automatically. If all are taken, kill other
Flask/Python processes:
```bash
# Linux / macOS
lsof -ti:5000 | xargs kill

# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

### PyInstaller build fails: missing module

Add `--hidden-import <module_name>` to the build command, or add it to
`hiddenimports` in `tradedesk.spec`.

### Low-spec machine performance

- The app is designed for 2 GB RAM minimum.
- SQLite with WAL mode handles concurrent reads efficiently.
- Limit chart data ranges (fewer days/months) for faster queries.
- Disable unused routes by removing blueprint registrations in `app.py`.

---

## 14. Extending the App

### Add a new API endpoint

1. Create a new route file in `backend/routes/` following the pattern of `sales.py`.
2. Register the blueprint in `backend/app.py`.
3. Add the corresponding fetch calls in `frontend/static/js/app.js`.

### Add a new database table

1. Add a `CREATE TABLE IF NOT EXISTS` block in `backend/models/database.py` inside `_create_tables()`.
2. Add indexes in `_create_indexes()`.
3. The table is created automatically on next application start.

### Add a new page

1. Add the HTML page `<div class="page" id="page-mypage">` in `index.html`.
2. Add a nav item: `<div class="nav-item" data-page="mypage" onclick="navigateTo('mypage',this)">`.
3. Add metadata to `PAGE_META` in `app.js`.
4. Add a `case 'mypage': await loadMyPage(); break;` in the `navigateTo()` switch.

### Change the currency symbol

Search for `KES` in `api.js` (the `formatCurrency` function) and `index.html`.

### Enable HTTPS (for multi-machine deployment)

Replace Werkzeug's built-in server in `run.py` with gunicorn + SSL:
```python
# In start_flask():
import subprocess
subprocess.Popen([
    "gunicorn", "--bind", f"{host}:{port}",
    "--certfile", "cert.pem", "--keyfile", "key.pem",
    "backend.app:create_app()",
])
```

---

*TradeDesk v1.0.0 — Built for offline-first business operations.*

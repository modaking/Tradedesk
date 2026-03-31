"""
backend/models/database.py
===========================
SQLite schema definition and connection helpers.

All SQL is parameterised — no string interpolation — preventing SQL injection.
Uses WAL journal mode for better concurrent read performance on low-spec machines.
"""

import sqlite3
import logging
import os
from contextlib import contextmanager
from typing import Generator

logger = logging.getLogger(__name__)

# Module-level path; set once by init_db()
_DB_PATH: str = ""


def init_db(db_path: str) -> None:
    """
    Create all tables if they don't exist, apply indexes, and seed the
    default admin user (username: admin / password: admin123).

    Args:
        db_path: Absolute path to the SQLite database file.
    """
    global _DB_PATH
    _DB_PATH = db_path

    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    with get_connection() as conn:
        _create_tables(conn)
        _create_indexes(conn)
        _apply_migrations(conn)
        _seed_default_admin(conn)
        conn.commit()

    logger.info("Database initialised at %s", db_path)


@contextmanager
def get_connection() -> Generator[sqlite3.Connection, None, None]:
    """
    Context manager that yields a SQLite connection with:
    - Row factory set to sqlite3.Row (dict-like access by column name)
    - WAL mode enabled
    - Foreign keys enforced
    - Automatic commit/rollback on exit
    """
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Schema
# ─────────────────────────────────────────────────────────────────────────────

def _create_tables(conn: sqlite3.Connection) -> None:
    """Define all application tables."""

    conn.executescript("""
        -- ── Users ────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    NOT NULL UNIQUE,
            email         TEXT    NOT NULL UNIQUE,
            password_hash TEXT    NOT NULL,
            role          TEXT    NOT NULL DEFAULT 'viewer'
                              CHECK(role IN ('admin','staff','viewer')),
            is_active     INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
            last_login    TEXT
        );

        -- ── Products ─────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS products (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            sku           TEXT    NOT NULL UNIQUE,
            name          TEXT    NOT NULL,
            category      TEXT    NOT NULL DEFAULT 'General',
            sell_price    REAL    NOT NULL DEFAULT 0.0,
            cost_price    REAL    NOT NULL DEFAULT 0.0,
            reorder_point INTEGER NOT NULL DEFAULT 10,
            is_active     INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        -- ── Inventory ────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS inventory (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id    INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
            quantity      INTEGER NOT NULL DEFAULT 0,
            location      TEXT    DEFAULT 'Main Warehouse',
            updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        -- ── Sales ────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS sales (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            reference       TEXT    NOT NULL UNIQUE,
            product_id      INTEGER NOT NULL REFERENCES products(id),
            quantity        INTEGER NOT NULL,
            unit_price      REAL    NOT NULL,
            total_amount    REAL    GENERATED ALWAYS AS (quantity * unit_price) STORED,
            customer_name   TEXT    DEFAULT '',
            payment_method  TEXT    DEFAULT 'Cash',
            salesperson     TEXT    DEFAULT '',
            status          TEXT    NOT NULL DEFAULT 'completed'
                                CHECK(status IN ('completed','pending','cancelled')),
            sale_date       TEXT    NOT NULL,
            created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            created_by      INTEGER REFERENCES users(id)
        );

        -- ── Purchases / Purchase Orders ───────────────────────────────────────
        CREATE TABLE IF NOT EXISTS purchases (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            reference     TEXT    NOT NULL UNIQUE,
            product_id    INTEGER NOT NULL REFERENCES products(id),
            quantity      INTEGER NOT NULL,
            unit_cost     REAL    NOT NULL,
            supplier      TEXT    DEFAULT '',
            status        TEXT    NOT NULL DEFAULT 'pending'
                              CHECK(status IN ('pending','received','cancelled')),
            order_date    TEXT    NOT NULL,
            received_date TEXT,
            created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
            created_by    INTEGER REFERENCES users(id)
        );

        -- ── Inventory Movements ───────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS inventory_movements (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id    INTEGER NOT NULL REFERENCES products(id),
            movement_type TEXT    NOT NULL
                              CHECK(movement_type IN ('sale','purchase','adjustment','return')),
            quantity_delta INTEGER NOT NULL,   -- positive = stock in, negative = stock out
            reference_id  INTEGER,            -- FK to sales or purchases table
            note          TEXT    DEFAULT '',
            moved_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            moved_by      INTEGER REFERENCES users(id)
        );

        -- ── Excel Import Logs ─────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS excel_import_logs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            filename        TEXT    NOT NULL,
            import_type     TEXT    NOT NULL CHECK(import_type IN ('sales','inventory','products')),
            total_rows      INTEGER NOT NULL DEFAULT 0,
            success_rows    INTEGER NOT NULL DEFAULT 0,
            failed_rows     INTEGER NOT NULL DEFAULT 0,
            status          TEXT    NOT NULL DEFAULT 'completed',
            imported_at     TEXT    NOT NULL DEFAULT (datetime('now')),
            imported_by     INTEGER REFERENCES users(id)
        );

        -- ── Failed Import Records ─────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS failed_import_records (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            import_log_id INTEGER NOT NULL REFERENCES excel_import_logs(id) ON DELETE CASCADE,
            row_number    INTEGER NOT NULL,
            failure_reason TEXT   NOT NULL,
            raw_data      TEXT    NOT NULL,  -- JSON string of original row values
            created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        -- ── Audit Log ─────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS audit_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER REFERENCES users(id),
            username    TEXT    NOT NULL DEFAULT '',
            action      TEXT    NOT NULL,        -- e.g. CREATE, UPDATE, DELETE
            entity_type TEXT    NOT NULL,        -- e.g. sale, product, user
            entity_id   INTEGER,
            detail      TEXT    NOT NULL DEFAULT '',
            ip_address  TEXT    NOT NULL DEFAULT '',
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
    """)

    logger.debug("Tables created / verified.")


def _create_indexes(conn: sqlite3.Connection) -> None:
    """Performance indexes on frequently queried columns."""

    conn.executescript("""
        CREATE INDEX IF NOT EXISTS idx_sales_date       ON sales(sale_date);
        CREATE INDEX IF NOT EXISTS idx_sales_product    ON sales(product_id);
        CREATE INDEX IF NOT EXISTS idx_sales_status     ON sales(status);
        CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
        CREATE INDEX IF NOT EXISTS idx_movements_product ON inventory_movements(product_id);
        CREATE INDEX IF NOT EXISTS idx_failed_import_log ON failed_import_records(import_log_id);
        CREATE INDEX IF NOT EXISTS idx_products_sku     ON products(sku);
        CREATE INDEX IF NOT EXISTS idx_products_active  ON products(is_active);
        CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON audit_log(user_id);
    """)

    logger.debug("Indexes created / verified.")


def _apply_migrations(conn: sqlite3.Connection) -> None:
    """
    Safe, idempotent schema migrations for existing databases.
    Each migration must be runnable multiple times without error.
    """
    # Migration 1: Ensure inventory.product_id has a UNIQUE constraint.
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_product_id_unique
        ON inventory(product_id)
    """)

    # Migration 2: Add failed login tracking columns to users table.
    # ALTER TABLE ADD COLUMN is idempotent-safe via try/except.
    for col_def in [
        "failed_login_attempts INTEGER NOT NULL DEFAULT 0",
        "locked_until TEXT",
    ]:
        col_name = col_def.split()[0]
        try:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col_def}")
            logger.info("Migration: added column users.%s", col_name)
        except Exception as e:
            if "duplicate column" in str(e).lower():
                pass  # Already exists — idempotent
            else:
                raise

    logger.debug("Migrations applied.")


def _seed_default_admin(conn: sqlite3.Connection) -> None:
    """
    Insert a default admin user if the users table is empty.
    Password is bcrypt-hashed. Change on first login!
    """
    import bcrypt

    row = conn.execute("SELECT COUNT(*) as cnt FROM users").fetchone()
    if row["cnt"] == 0:
        raw_password = "admin123"
        hashed = bcrypt.hashpw(raw_password.encode(), bcrypt.gensalt()).decode()
        conn.execute(
            """
            INSERT INTO users (username, email, password_hash, role)
            VALUES (?, ?, ?, 'admin')
            """,
            ("admin", "admin@tradedesk.local", hashed),
        )
        logger.info("Default admin user seeded (username=admin, password=admin123). Change immediately!")

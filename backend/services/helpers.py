"""
backend/services/helpers.py
============================
Shared utilities used across all route modules:
  - require_auth(roles)   — authentication/authorisation decorator
  - sanitize_str()        — strip and limit input strings
  - paginate_query()      — SQLite LIMIT/OFFSET pagination
  - make_reference()      — generate unique sale/purchase references
  - row_to_dict()         — convert sqlite3.Row to plain dict
"""

import re
import uuid
import logging
from functools import wraps
from typing import Callable, List, Optional, Tuple

from flask import session, jsonify, request

logger = logging.getLogger(__name__)


# ── Auth Decorator ────────────────────────────────────────────────────────────

def require_auth(roles: Optional[List[str]] = None):
    """
    Decorator factory that enforces:
      1. Valid session (logged in)
      2. Role membership if `roles` list is provided

    Usage:
        @require_auth()                        — any authenticated user
        @require_auth(roles=["admin"])         — admin only
        @require_auth(roles=["admin","staff"]) — admin or staff
    """
    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if "user_id" not in session:
                return jsonify({"error": "Authentication required."}), 401

            if roles and session.get("role") not in roles:
                logger.warning(
                    "Forbidden: user %s (role=%s) tried to access %s",
                    session.get("username"),
                    session.get("role"),
                    request.path,
                )
                return jsonify({"error": "Insufficient permissions."}), 403

            return fn(*args, **kwargs)
        return wrapper
    return decorator


# ── Input Sanitisation ────────────────────────────────────────────────────────

def sanitize_str(value: any, max_len: int = 500) -> str:
    """
    Strip leading/trailing whitespace, collapse internal whitespace,
    and truncate to max_len.  Returns empty string for non-string input.
    """
    if not isinstance(value, str):
        return ""
    cleaned = re.sub(r"\s+", " ", value.strip())
    return cleaned[:max_len]


def sanitize_positive_int(value: any, default: int = 0) -> int:
    """Parse value as a non-negative integer; return default on failure."""
    try:
        n = int(value)
        return max(0, n)
    except (TypeError, ValueError):
        return default


def sanitize_positive_float(value: any, default: float = 0.0) -> float:
    """Parse value as a non-negative float; return default on failure."""
    try:
        f = float(value)
        return max(0.0, f)
    except (TypeError, ValueError):
        return default


# ── Reference Generator ───────────────────────────────────────────────────────

def make_reference(prefix: str = "TRD") -> str:
    """
    Generate a short unique reference string e.g. TRD-A1B2C3D4.
    Uses the first 8 hex chars of a UUID4 — collision probability is negligible
    for small business volumes.
    """
    short = uuid.uuid4().hex[:8].upper()
    return f"{prefix}-{short}"


# ── Pagination ────────────────────────────────────────────────────────────────

def get_pagination_params() -> Tuple[int, int]:
    """
    Read `page` and `per_page` from request query string.
    Returns (offset, limit) ready for SQL LIMIT/OFFSET.
    """
    try:
        page = max(1, int(request.args.get("page", 1)))
    except (ValueError, TypeError):
        page = 1
    try:
        per_page = min(200, max(5, int(request.args.get("per_page", 25))))
    except (ValueError, TypeError):
        per_page = 25

    offset = (page - 1) * per_page
    return offset, per_page


# ── Row Converter ─────────────────────────────────────────────────────────────

def row_to_dict(row) -> dict:
    """Convert a sqlite3.Row object to a plain Python dict."""
    return dict(row) if row is not None else {}


def rows_to_list(rows) -> list:
    """Convert a list of sqlite3.Row objects to a list of dicts."""
    return [dict(r) for r in rows]


# ── Audit Log Writer ──────────────────────────────────────────────────────────

def audit_write(action: str, entity_type: str, entity_id: int = None, detail: str = "") -> None:
    """
    Write one row to the audit_log table.
    Safe to call from any route — silently swallows errors so a logging
    failure never breaks the main request.

    Usage:
        audit_write("CREATE", "sale", sale_id, f"ref={reference}")
        audit_write("DELETE", "product", product_id, product_name)
    """
    try:
        from backend.models.database import get_connection
        user_id  = session.get("user_id")
        username = session.get("username", "")
        ip       = request.remote_addr or ""
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, detail, ip_address)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, username, action, entity_type, entity_id, detail[:1000], ip),
            )
    except Exception:
        logger.exception("audit_write failed silently")

"""
backend/routes/audit.py
========================
Audit log — read-only listing of all write actions.

GET /api/audit-log/          — paginated log (admin only)
"""

import logging
from flask import Blueprint, request, jsonify
from backend.models.database import get_connection
from backend.services.helpers import require_auth, sanitize_str, get_pagination_params, rows_to_list

logger = logging.getLogger(__name__)
audit_bp = Blueprint("audit", __name__)


@audit_bp.route("/", methods=["GET"])
@require_auth(roles=["admin"])
def list_audit_log():
    """GET /api/audit-log/?page=1&per_page=50&search=&entity_type="""
    search      = sanitize_str(request.args.get("search", ""))
    entity_type = sanitize_str(request.args.get("entity_type", ""))
    offset, limit = get_pagination_params()

    conditions: list[str] = []
    params: list = []

    if search:
        conditions.append("(a.username LIKE ? OR a.action LIKE ? OR a.detail LIKE ?)")
        like = f"%{search}%"
        params += [like, like, like]

    if entity_type:
        conditions.append("a.entity_type = ?")
        params.append(entity_type)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with get_connection() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) as cnt FROM audit_log a {where}", params
        ).fetchone()["cnt"]

        rows = conn.execute(
            f"""
            SELECT a.*
            FROM audit_log a
            {where}
            ORDER BY a.created_at DESC
            LIMIT ? OFFSET ?
            """,
            params + [limit, offset],
        ).fetchall()

    return jsonify({"total": total, "records": rows_to_list(rows)})

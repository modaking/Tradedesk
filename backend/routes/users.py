"""
backend/routes/users.py
========================
User management — admin only (except own profile).

GET    /api/users/         — list all users (admin)
POST   /api/users/         — create user (admin)
PUT    /api/users/<id>     — update user (admin, or self for email)
DELETE /api/users/<id>     — deactivate user (admin only)
"""

import logging
import bcrypt
from flask import Blueprint, request, jsonify, session
from backend.models.database import get_connection
from backend.services.helpers import require_auth, sanitize_str, rows_to_list, row_to_dict

logger = logging.getLogger(__name__)
users_bp = Blueprint("users", __name__)


@users_bp.route("/", methods=["GET"])
@require_auth(roles=["admin"])
def list_users():
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, username, email, role, is_active, created_at, last_login FROM users ORDER BY id"
        ).fetchall()
    return jsonify(rows_to_list(rows))


@users_bp.route("/", methods=["POST"])
@require_auth(roles=["admin"])
def create_user():
    data = request.get_json(silent=True) or {}
    username = sanitize_str(data.get("username", ""), max_len=100)
    email = sanitize_str(data.get("email", ""), max_len=200)
    password = str(data.get("password", ""))
    role = sanitize_str(data.get("role", "viewer"), max_len=20)

    errors = []
    if not username:
        errors.append("Username is required.")
    if not email or "@" not in email:
        errors.append("Valid email is required.")
    if len(password) < 8:
        errors.append("Password must be at least 8 characters.")
    if role not in ("admin", "staff", "viewer"):
        errors.append("Role must be admin, staff, or viewer.")
    if errors:
        return jsonify({"success": False, "errors": errors}), 400

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()

    try:
        with get_connection() as conn:
            cursor = conn.execute(
                "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)",
                (username, email, hashed, role),
            )
            user_id = cursor.lastrowid
    except Exception as e:
        if "UNIQUE" in str(e):
            return jsonify({"success": False, "errors": ["Username or email already exists."]}), 409
        raise

    logger.info("User created: username=%s role=%s by admin=%s", username, role, session["username"])
    return jsonify({"success": True, "user_id": user_id}), 201


@users_bp.route("/<int:user_id>", methods=["PUT"])
@require_auth(roles=["admin"])
def update_user(user_id: int):
    data = request.get_json(silent=True) or {}
    email = sanitize_str(data.get("email", ""), max_len=200)
    role = sanitize_str(data.get("role", ""), max_len=20)
    is_active = data.get("is_active")

    with get_connection() as conn:
        existing = conn.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    if not existing:
        return jsonify({"error": "User not found."}), 404

    fields, params = [], []
    if email:
        fields.append("email=?")
        params.append(email)
    if role in ("admin", "staff", "viewer"):
        fields.append("role=?")
        params.append(role)
    if is_active is not None:
        fields.append("is_active=?")
        params.append(1 if is_active else 0)

    if not fields:
        return jsonify({"error": "Nothing to update."}), 400

    params.append(user_id)
    with get_connection() as conn:
        conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id=?", params)

    return jsonify({"success": True})


@users_bp.route("/<int:user_id>", methods=["DELETE"])
@require_auth(roles=["admin"])
def delete_user(user_id: int):
    """Soft delete — sets is_active=0."""
    if user_id == session["user_id"]:
        return jsonify({"error": "Cannot deactivate your own account."}), 400
    with get_connection() as conn:
        conn.execute("UPDATE users SET is_active=0 WHERE id=?", (user_id,))
    return jsonify({"success": True})

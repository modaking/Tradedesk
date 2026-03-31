"""
backend/routes/auth.py
=======================
Authentication endpoints: login, logout, session check.

Security measures:
  - bcrypt password hashing (cost factor 12)
  - Flask server-side sessions (no JWT secret in client)
  - Role stored in session, validated per request via decorator
  - Failed login attempts are logged but not enumerated to client
"""

import logging
from datetime import datetime, timedelta
import bcrypt
from flask import Blueprint, request, jsonify, session
from backend.models.database import get_connection
from backend.services.helpers import sanitize_str, require_auth

logger = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__)

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


@auth_bp.route("/login", methods=["POST"])
def login():
    """
    POST /api/auth/login
    Body: { "username": str, "password": str }
    Returns: { "success": bool, "role": str, "username": str }

    Locks accounts for LOCKOUT_MINUTES after MAX_FAILED_ATTEMPTS wrong passwords.
    """
    data = request.get_json(silent=True) or {}
    username = sanitize_str(data.get("username", ""))
    password = str(data.get("password", ""))

    if not username or not password:
        return jsonify({"success": False, "error": "Username and password are required."}), 400

    with get_connection() as conn:
        user = conn.execute(
            """SELECT id, username, password_hash, role, is_active,
                      COALESCE(failed_login_attempts, 0) AS failed_login_attempts,
                      locked_until
               FROM users WHERE username = ?""",
            (username,),
        ).fetchone()

    # Constant-time rejection — don't reveal whether username exists
    if user is None or not user["is_active"]:
        bcrypt.checkpw(b"dummy", bcrypt.hashpw(b"dummy", bcrypt.gensalt()))
        logger.warning("Failed login attempt for unknown/inactive username=%s", username)
        return jsonify({"success": False, "error": "Invalid credentials."}), 401

    # Check lockout
    if user["locked_until"]:
        try:
            locked_until_dt = datetime.fromisoformat(user["locked_until"])
            if datetime.utcnow() < locked_until_dt:
                remaining = int((locked_until_dt - datetime.utcnow()).total_seconds() // 60) + 1
                logger.warning("Locked account login attempt for username=%s", username)
                return jsonify({
                    "success": False,
                    "error": f"Account locked due to too many failed attempts. "
                             f"Try again in {remaining} minute{'s' if remaining != 1 else ''}.",
                    "locked": True,
                    "retry_after_minutes": remaining,
                }), 429
        except ValueError:
            pass  # Malformed timestamp — treat as not locked

    if not bcrypt.checkpw(password.encode(), user["password_hash"].encode()):
        # Increment failure counter; lock if threshold reached
        new_attempts = user["failed_login_attempts"] + 1
        if new_attempts >= MAX_FAILED_ATTEMPTS:
            locked_until = (datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
            with get_connection() as conn:
                conn.execute(
                    "UPDATE users SET failed_login_attempts=?, locked_until=? WHERE id=?",
                    (new_attempts, locked_until, user["id"]),
                )
            logger.warning(
                "Account locked for username=%s after %d failed attempts",
                username, new_attempts,
            )
            return jsonify({
                "success": False,
                "error": f"Too many failed attempts. Account locked for {LOCKOUT_MINUTES} minutes.",
                "locked": True,
                "retry_after_minutes": LOCKOUT_MINUTES,
            }), 429
        else:
            with get_connection() as conn:
                conn.execute(
                    "UPDATE users SET failed_login_attempts=? WHERE id=?",
                    (new_attempts, user["id"]),
                )
            remaining_attempts = MAX_FAILED_ATTEMPTS - new_attempts
            logger.warning("Bad password for username=%s (%d attempts remaining)", username, remaining_attempts)
            return jsonify({
                "success": False,
                "error": f"Invalid credentials. {remaining_attempts} attempt{'s' if remaining_attempts != 1 else ''} remaining before lockout.",
            }), 401

    # Successful login — reset failure counters and update last_login
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET last_login=datetime('now'), failed_login_attempts=0, locked_until=NULL WHERE id=?",
            (user["id"],),
        )

    # Store minimal info in server-side session
    session.clear()
    session["user_id"] = user["id"]
    session["username"] = user["username"]
    session["role"] = user["role"]
    session.permanent = False

    logger.info("User %s logged in (role=%s)", user["username"], user["role"])
    return jsonify({"success": True, "username": user["username"], "role": user["role"]})


@auth_bp.route("/logout", methods=["POST"])
def logout():
    """POST /api/auth/logout — clears the server session."""
    username = session.get("username", "unknown")
    session.clear()
    logger.info("User %s logged out.", username)
    return jsonify({"success": True})


@auth_bp.route("/me", methods=["GET"])
def me():
    """GET /api/auth/me — returns current session user or 401."""
    if "user_id" not in session:
        return jsonify({"authenticated": False}), 401
    return jsonify({
        "authenticated": True,
        "user_id": session["user_id"],
        "username": session["username"],
        "role": session["role"],
    })


@auth_bp.route("/unlock/<int:user_id>", methods=["POST"])
@require_auth(roles=["admin"])
def unlock_user(user_id: int):
    """POST /api/auth/unlock/<id> — admin manually unlocks a locked account."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE id=?",
            (user_id,),
        )
    logger.info("Account user_id=%s unlocked by admin %s", user_id, session.get("username"))
    return jsonify({"success": True})



@auth_bp.route("/change-password", methods=["POST"])
@require_auth(roles=["admin", "staff", "viewer"])
def change_password():
    """
    POST /api/auth/change-password
    Body: { "old_password": str, "new_password": str }
    """
    data = request.get_json(silent=True) or {}
    old_pw = str(data.get("old_password", ""))
    new_pw = str(data.get("new_password", ""))

    if len(new_pw) < 8:
        return jsonify({"success": False, "error": "New password must be at least 8 characters."}), 400

    with get_connection() as conn:
        user = conn.execute(
            "SELECT password_hash FROM users WHERE id = ?", (session["user_id"],)
        ).fetchone()

    if not bcrypt.checkpw(old_pw.encode(), user["password_hash"].encode()):
        return jsonify({"success": False, "error": "Old password is incorrect."}), 403

    new_hash = bcrypt.hashpw(new_pw.encode(), bcrypt.gensalt(rounds=12)).decode()
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (new_hash, session["user_id"]),
        )

    logger.info("Password changed for user_id=%s", session["user_id"])
    return jsonify({"success": True})


@auth_bp.route("/change-username", methods=["POST"])
@require_auth(roles=["admin", "staff", "viewer"])
def change_username():
    """
    POST /api/auth/change-username
    Body: { "new_username": str, "current_password": str }
    Forces logout after success so the user re-authenticates.
    """
    data = request.get_json(silent=True) or {}
    new_username = sanitize_str(data.get("new_username", ""), max_len=100)
    current_pw   = str(data.get("current_password", ""))

    if not new_username or len(new_username) < 3:
        return jsonify({"success": False, "error": "Username must be at least 3 characters."}), 400
    if not current_pw:
        return jsonify({"success": False, "error": "Current password is required."}), 400

    with get_connection() as conn:
        user = conn.execute(
            "SELECT password_hash FROM users WHERE id = ?", (session["user_id"],)
        ).fetchone()

    if not bcrypt.checkpw(current_pw.encode(), user["password_hash"].encode()):
        return jsonify({"success": False, "error": "Current password is incorrect."}), 403

    try:
        with get_connection() as conn:
            conn.execute(
                "UPDATE users SET username = ? WHERE id = ?",
                (new_username, session["user_id"]),
            )
    except Exception as e:
        if "UNIQUE" in str(e):
            return jsonify({"success": False, "error": "That username is already taken."}), 409
        raise

    logger.info("Username changed for user_id=%s to '%s'", session["user_id"], new_username)
    session.clear()
    return jsonify({"success": True})

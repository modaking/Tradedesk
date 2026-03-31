"""
backend/routes/products.py
===========================
CRUD for the Products catalogue.

GET    /api/products/        — list (paginated, searchable)
POST   /api/products/        — create new product
GET    /api/products/<id>    — single product
PUT    /api/products/<id>    — update
DELETE /api/products/<id>    — soft delete (is_active=0, admin only)
"""

import logging
import uuid
from flask import Blueprint, request, jsonify, session
from backend.models.database import get_connection
from backend.services.helpers import (
    require_auth, sanitize_str, sanitize_positive_int,
    sanitize_positive_float, rows_to_list, row_to_dict, get_pagination_params
)

logger = logging.getLogger(__name__)
products_bp = Blueprint("products", __name__)


def _generate_sku() -> str:
    """Generate a short unique SKU like SKU-A1B2C3."""
    return "SKU-" + uuid.uuid4().hex[:6].upper()


@products_bp.route("/", methods=["GET"])
@require_auth()
def list_products():
    """
    GET /api/products/?search=...&category=...&active_only=1&page=1&per_page=25
    """
    search = sanitize_str(request.args.get("search", ""))
    category = sanitize_str(request.args.get("category", ""))
    active_only = request.args.get("active_only", "1") == "1"
    offset, limit = get_pagination_params()

    conditions = []
    params: list = []

    if active_only:
        conditions.append("p.is_active = 1")

    if search:
        conditions.append("(p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ?)")
        like = f"%{search}%"
        params += [like, like, like]

    if category:
        conditions.append("p.category = ?")
        params.append(category)

    where_sql = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    base_query = f"""
        SELECT p.*, COALESCE(i.quantity, 0) AS stock_quantity
        FROM products p
        LEFT JOIN inventory i ON i.product_id = p.id
        {where_sql}
    """

    with get_connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) as cnt FROM ({base_query})", params).fetchone()["cnt"]
        rows = conn.execute(
            f"{base_query} ORDER BY p.name ASC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()

        # Category list for filter dropdowns
        categories = conn.execute(
            "SELECT DISTINCT category FROM products WHERE is_active = 1 ORDER BY category"
        ).fetchall()

    return jsonify({
        "total": total,
        "records": rows_to_list(rows),
        "categories": [r["category"] for r in categories],
    })


@products_bp.route("/", methods=["POST"])
@require_auth(roles=["admin", "staff"])
def create_product():
    """POST /api/products/ — create new product and its initial inventory record."""
    data = request.get_json(silent=True) or {}

    name = sanitize_str(data.get("name", ""), max_len=300)
    category = sanitize_str(data.get("category", "General"), max_len=100)
    sell_price = sanitize_positive_float(data.get("sell_price", 0))
    cost_price = sanitize_positive_float(data.get("cost_price", 0))
    reorder_point = sanitize_positive_int(data.get("reorder_point", 10))
    sku = sanitize_str(data.get("sku", ""), max_len=50) or _generate_sku()
    initial_qty = sanitize_positive_int(data.get("initial_quantity", 0))

    errors = []
    if not name:
        errors.append("Product name is required.")
    if sell_price <= 0:
        errors.append("Sell price must be greater than 0.")
    if errors:
        return jsonify({"success": False, "errors": errors}), 400

    # Check for duplicate SKU
    with get_connection() as conn:
        dup = conn.execute("SELECT id FROM products WHERE sku = ?", (sku,)).fetchone()
        if dup:
            return jsonify({"success": False, "errors": [f"SKU '{sku}' already exists."]}), 409

        cursor = conn.execute(
            """
            INSERT INTO products (sku, name, category, sell_price, cost_price, reorder_point)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (sku, name, category, sell_price, cost_price, reorder_point),
        )
        product_id = cursor.lastrowid

        # Create inventory record
        conn.execute(
            "INSERT INTO inventory (product_id, quantity) VALUES (?, ?)",
            (product_id, initial_qty),
        )

    logger.info("Product created: sku=%s by user_id=%s", sku, session["user_id"])
    return jsonify({"success": True, "product_id": product_id, "sku": sku}), 201


@products_bp.route("/<int:product_id>", methods=["GET"])
@require_auth()
def get_product(product_id: int):
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT p.*, COALESCE(i.quantity, 0) AS stock_quantity
            FROM products p LEFT JOIN inventory i ON i.product_id = p.id
            WHERE p.id = ?
            """,
            (product_id,),
        ).fetchone()
    if not row:
        return jsonify({"error": "Product not found."}), 404
    return jsonify(row_to_dict(row))


@products_bp.route("/<int:product_id>", methods=["PUT"])
@require_auth(roles=["admin", "staff"])
def update_product(product_id: int):
    data = request.get_json(silent=True) or {}
    with get_connection() as conn:
        existing = conn.execute("SELECT id FROM products WHERE id=?", (product_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Product not found."}), 404

    name = sanitize_str(data.get("name", ""), max_len=300)
    category = sanitize_str(data.get("category", "General"), max_len=100)
    sell_price = sanitize_positive_float(data.get("sell_price", 0))
    cost_price = sanitize_positive_float(data.get("cost_price", 0))
    reorder_point = sanitize_positive_int(data.get("reorder_point", 10))

    with get_connection() as conn:
        conn.execute(
            """
            UPDATE products
            SET name=?, category=?, sell_price=?, cost_price=?,
                reorder_point=?, updated_at=datetime('now')
            WHERE id=?
            """,
            (name, category, sell_price, cost_price, reorder_point, product_id),
        )
    return jsonify({"success": True})


@products_bp.route("/<int:product_id>", methods=["DELETE"])
@require_auth(roles=["admin"])
def delete_product(product_id: int):
    """Soft delete — sets is_active=0 to preserve sales history."""
    with get_connection() as conn:
        conn.execute("UPDATE products SET is_active=0 WHERE id=?", (product_id,))
    logger.info("Product id=%s deactivated by user_id=%s", product_id, session["user_id"])
    return jsonify({"success": True})

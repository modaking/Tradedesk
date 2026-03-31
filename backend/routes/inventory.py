"""
backend/routes/inventory.py
============================
Inventory viewing and stock adjustment endpoints.

GET  /api/inventory/            — list with stock levels
POST /api/inventory/adjust      — manual stock adjustment
GET  /api/inventory/low-stock   — items below reorder point
GET  /api/inventory/movements   — movement history
"""

import logging
from flask import Blueprint, request, jsonify, session
from backend.models.database import get_connection
from backend.services.helpers import (
    require_auth, sanitize_str, sanitize_positive_int, rows_to_list, row_to_dict, get_pagination_params
)

logger = logging.getLogger(__name__)
inventory_bp = Blueprint("inventory", __name__)


@inventory_bp.route("/", methods=["GET"])
@require_auth()
def list_inventory():
    """
    GET /api/inventory/?search=...&status=in_stock|low_stock|out_of_stock
    """
    search = sanitize_str(request.args.get("search", ""))
    status_filter = sanitize_str(request.args.get("status", ""))
    offset, limit = get_pagination_params()

    conditions = ["p.is_active = 1"]
    params: list = []

    if search:
        conditions.append("(p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ?)")
        like = f"%{search}%"
        params += [like, like, like]

    if status_filter == "out_of_stock":
        conditions.append("COALESCE(i.quantity, 0) = 0")
    elif status_filter == "low_stock":
        conditions.append("COALESCE(i.quantity, 0) > 0 AND COALESCE(i.quantity, 0) < p.reorder_point")
    elif status_filter == "in_stock":
        conditions.append("COALESCE(i.quantity, 0) >= p.reorder_point")

    where_sql = "WHERE " + " AND ".join(conditions)
    base_query = f"""
        SELECT p.id, p.sku, p.name, p.category, p.sell_price, p.cost_price,
               p.reorder_point, COALESCE(i.quantity, 0) AS quantity,
               COALESCE(i.location, 'Main Warehouse') AS location,
               i.updated_at AS inventory_updated_at,
               (COALESCE(i.quantity, 0) * p.cost_price) AS total_value,
               CASE
                 WHEN COALESCE(i.quantity, 0) = 0 THEN 'out_of_stock'
                 WHEN COALESCE(i.quantity, 0) < p.reorder_point THEN 'low_stock'
                 ELSE 'in_stock'
               END AS stock_status
        FROM products p
        LEFT JOIN inventory i ON i.product_id = p.id
        {where_sql}
    """

    with get_connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) as cnt FROM ({base_query})", params).fetchone()["cnt"]
        rows = conn.execute(
            f"{base_query} ORDER BY stock_status ASC, p.name ASC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()

        # Summary stats
        stats = conn.execute("""
            SELECT
              COUNT(*) as total_products,
              SUM(COALESCE(i.quantity, 0)) as total_units,
              SUM(COALESCE(i.quantity, 0) * p.cost_price) as total_value,
              SUM(CASE WHEN COALESCE(i.quantity, 0) = 0 THEN 1 ELSE 0 END) as out_of_stock,
              SUM(CASE WHEN COALESCE(i.quantity, 0) > 0
                       AND COALESCE(i.quantity, 0) < p.reorder_point THEN 1 ELSE 0 END) as low_stock
            FROM products p LEFT JOIN inventory i ON i.product_id = p.id
            WHERE p.is_active = 1
        """).fetchone()

    return jsonify({
        "total": total,
        "records": rows_to_list(rows),
        "stats": row_to_dict(stats),
    })


@inventory_bp.route("/<int:product_id>", methods=["GET"])
@require_auth()
def get_inventory_item(product_id: int):
    """GET /api/inventory/<product_id> — single inventory record."""
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT p.id, p.sku, p.name, p.category, p.sell_price, p.cost_price,
                   p.reorder_point, COALESCE(i.quantity, 0) AS quantity,
                   COALESCE(i.location, 'Main Warehouse') AS location,
                   i.updated_at AS inventory_updated_at,
                   (COALESCE(i.quantity, 0) * p.cost_price) AS total_value,
                   CASE
                     WHEN COALESCE(i.quantity, 0) = 0 THEN 'out_of_stock'
                     WHEN COALESCE(i.quantity, 0) < p.reorder_point THEN 'low_stock'
                     ELSE 'in_stock'
                   END AS stock_status
            FROM products p
            LEFT JOIN inventory i ON i.product_id = p.id
            WHERE p.id = ? AND p.is_active = 1
            """,
            (product_id,),
        ).fetchone()
    if not row:
        return jsonify({"error": "Item not found."}), 404
    return jsonify(row_to_dict(row))


@inventory_bp.route("/adjust", methods=["POST"])
@require_auth(roles=["admin", "staff"])
def adjust_stock():
    """
    POST /api/inventory/adjust
    Body: { product_id, delta, note }
    delta is positive (stock in) or negative (stock out).
    """
    data = request.get_json(silent=True) or {}
    product_id = sanitize_positive_int(data.get("product_id"))
    delta = int(data.get("delta", 0))
    note = sanitize_str(data.get("note", "Manual adjustment"), max_len=500)

    if not product_id:
        return jsonify({"error": "product_id is required."}), 400
    if delta == 0:
        return jsonify({"error": "delta cannot be 0."}), 400

    with get_connection() as conn:
        product = conn.execute(
            "SELECT id FROM products WHERE id=? AND is_active=1", (product_id,)
        ).fetchone()
        if not product:
            return jsonify({"error": "Product not found."}), 404

        # Prevent going below 0
        current = conn.execute(
            "SELECT COALESCE(quantity, 0) as qty FROM inventory WHERE product_id=?", (product_id,)
        ).fetchone()
        current_qty = current["qty"] if current else 0
        new_qty = max(0, current_qty + delta)
        # FIX: Record the actual change applied, not the requested delta.
        # If delta=-50 but only 10 in stock, actual_delta=-10 so movements sum correctly.
        actual_delta = new_qty - current_qty

        conn.execute(
            """
            INSERT INTO inventory (product_id, quantity)
            VALUES (?, ?)
            ON CONFLICT(product_id) DO UPDATE
            SET quantity=excluded.quantity, updated_at=datetime('now')
            """,
            (product_id, new_qty),
        )

        conn.execute(
            """
            INSERT INTO inventory_movements
              (product_id, movement_type, quantity_delta, note, moved_by)
            VALUES (?, 'adjustment', ?, ?, ?)
            """,
            (product_id, actual_delta, note, session["user_id"]),
        )

    logger.info("Inventory adjusted: product_id=%s requested=%s actual=%s new_qty=%s",
                product_id, delta, actual_delta, new_qty)
    return jsonify({"success": True, "new_quantity": new_qty,
                    "actual_delta": actual_delta, "requested_delta": delta})


@inventory_bp.route("/<int:product_id>", methods=["PUT"])
@require_auth(roles=["admin", "staff"])
def update_inventory(product_id: int):
    """PUT /api/inventory/<product_id> — set quantity and location directly."""
    data = request.get_json(silent=True) or {}
    quantity = data.get("quantity")
    location = sanitize_str(data.get("location", "Main Warehouse"), max_len=200) or "Main Warehouse"

    if quantity is None:
        return jsonify({"error": "quantity is required."}), 400
    try:
        quantity = int(quantity)
        if quantity < 0:
            raise ValueError()
    except (ValueError, TypeError):
        return jsonify({"error": "quantity must be a non-negative integer."}), 400

    with get_connection() as conn:
        product = conn.execute(
            "SELECT id, name FROM products WHERE id=? AND is_active=1", (product_id,)
        ).fetchone()
        if not product:
            return jsonify({"error": "Product not found."}), 404

        current = conn.execute(
            "SELECT COALESCE(quantity, 0) as qty FROM inventory WHERE product_id=?", (product_id,)
        ).fetchone()
        old_qty = current["qty"] if current else 0
        delta = quantity - old_qty

        conn.execute(
            """
            INSERT INTO inventory (product_id, quantity, location)
            VALUES (?, ?, ?)
            ON CONFLICT(product_id) DO UPDATE
            SET quantity=excluded.quantity, location=excluded.location, updated_at=datetime('now')
            """,
            (product_id, quantity, location),
        )

        if delta != 0:
            conn.execute(
                """
                INSERT INTO inventory_movements
                  (product_id, movement_type, quantity_delta, note, moved_by)
                VALUES (?, 'adjustment', ?, ?, ?)
                """,
                (product_id, delta, f"Direct edit (location: {location})", session["user_id"]),
            )

    return jsonify({"success": True, "product_id": product_id, "quantity": quantity, "location": location})


@inventory_bp.route("/low-stock", methods=["GET"])
@require_auth()
def low_stock():
    """GET /api/inventory/low-stock — products at or below reorder point."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT p.id, p.sku, p.name, p.category, p.reorder_point,
                   COALESCE(i.quantity, 0) as quantity
            FROM products p LEFT JOIN inventory i ON i.product_id = p.id
            WHERE p.is_active = 1 AND COALESCE(i.quantity, 0) <= p.reorder_point
            ORDER BY quantity ASC
        """).fetchall()
    return jsonify(rows_to_list(rows))


@inventory_bp.route("/movements", methods=["GET"])
@require_auth()
def list_movements():
    """GET /api/inventory/movements — recent stock movements."""
    offset, limit = get_pagination_params()
    with get_connection() as conn:
        total = conn.execute("SELECT COUNT(*) as cnt FROM inventory_movements").fetchone()["cnt"]
        rows = conn.execute("""
            SELECT m.*, p.name AS product_name, p.sku AS product_sku, u.username AS moved_by_name
            FROM inventory_movements m
            JOIN products p ON m.product_id = p.id
            LEFT JOIN users u ON m.moved_by = u.id
            ORDER BY m.moved_at DESC LIMIT ? OFFSET ?
        """, (limit, offset)).fetchall()
    return jsonify({"total": total, "records": rows_to_list(rows)})

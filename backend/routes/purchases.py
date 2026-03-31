"""
backend/routes/purchases.py
============================
Purchase order management — receive stock into inventory.

GET    /api/purchases/           — list purchase orders
POST   /api/purchases/           — create new purchase order
PUT    /api/purchases/<id>/receive — mark as received (updates inventory)
DELETE /api/purchases/<id>       — cancel order (admin only)
"""

import logging
from flask import Blueprint, request, jsonify, session
from backend.models.database import get_connection
from backend.services.helpers import (
    require_auth, sanitize_str, sanitize_positive_int,
    sanitize_positive_float, make_reference, get_pagination_params,
    rows_to_list, row_to_dict
)

logger = logging.getLogger(__name__)
purchases_bp = Blueprint("purchases", __name__)


@purchases_bp.route("/", methods=["GET"])
@require_auth()
def list_purchases():
    """GET /api/purchases/?status=pending|received|cancelled"""
    status_filter = sanitize_str(request.args.get("status", ""))
    offset, limit = get_pagination_params()

    conditions = []
    params: list = []

    if status_filter in ("pending", "received", "cancelled"):
        conditions.append("po.status = ?")
        params.append(status_filter)

    where_sql = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with get_connection() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) as cnt FROM purchases po {where_sql}", params
        ).fetchone()["cnt"]

        rows = conn.execute(f"""
            SELECT po.*, p.name AS product_name, p.sku AS product_sku,
                   u.username AS created_by_name
            FROM purchases po
            JOIN products p ON po.product_id = p.id
            LEFT JOIN users u ON po.created_by = u.id
            {where_sql}
            ORDER BY po.order_date DESC LIMIT ? OFFSET ?
        """, params + [limit, offset]).fetchall()

    return jsonify({"total": total, "records": rows_to_list(rows)})


@purchases_bp.route("/", methods=["POST"])
@require_auth(roles=["admin", "staff"])
def create_purchase():
    """
    POST /api/purchases/
    Body: { product_id, quantity, unit_cost, supplier?, order_date }
    """
    data = request.get_json(silent=True) or {}
    product_id  = sanitize_positive_int(data.get("product_id"))
    quantity    = sanitize_positive_int(data.get("quantity"))
    unit_cost   = sanitize_positive_float(data.get("unit_cost", 0))
    supplier    = sanitize_str(data.get("supplier", ""), max_len=200)
    order_date  = sanitize_str(data.get("order_date", ""))

    errors = []
    if not product_id:   errors.append("Product is required.")
    if quantity <= 0:    errors.append("Quantity must be > 0.")
    if unit_cost <= 0:   errors.append("Unit cost must be > 0.")
    if not order_date:   errors.append("Order date is required.")
    if errors:
        return jsonify({"success": False, "errors": errors}), 400

    with get_connection() as conn:
        product = conn.execute(
            "SELECT id FROM products WHERE id=? AND is_active=1", (product_id,)
        ).fetchone()
    if not product:
        return jsonify({"success": False, "errors": ["Product not found."]}), 404

    reference = make_reference("PO")

    with get_connection() as conn:
        cursor = conn.execute("""
            INSERT INTO purchases
              (reference, product_id, quantity, unit_cost, supplier, status, order_date, created_by)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        """, (reference, product_id, quantity, unit_cost, supplier, order_date, session["user_id"]))
        po_id = cursor.lastrowid

    logger.info("Purchase order created: %s for product_id=%s", reference, product_id)
    return jsonify({"success": True, "reference": reference, "purchase_id": po_id}), 201


@purchases_bp.route("/<int:po_id>/receive", methods=["PUT"])
@require_auth(roles=["admin", "staff"])
def receive_purchase(po_id: int):
    """
    PUT /api/purchases/<id>/receive
    Marks a pending order as received and increments inventory.
    Body: { received_date? }
    """
    data = request.get_json(silent=True) or {}
    # FIX: Default to today's date rather than storing NULL when no date is supplied
    from datetime import date as _date
    received_date = sanitize_str(data.get("received_date", "")) or _date.today().isoformat()

    with get_connection() as conn:
        po = conn.execute("SELECT * FROM purchases WHERE id=?", (po_id,)).fetchone()
        if not po:
            return jsonify({"error": "Purchase order not found."}), 404
        if po["status"] != "pending":
            return jsonify({"error": f"Cannot receive an order with status '{po['status']}'."}), 400

        # Mark received
        conn.execute("""
            UPDATE purchases SET status='received', received_date=? WHERE id=?
        """, (received_date, po_id))

        # Increment inventory
        conn.execute("""
            INSERT INTO inventory (product_id, quantity)
            VALUES (?, ?)
            ON CONFLICT(product_id) DO UPDATE
            SET quantity = quantity + excluded.quantity, updated_at = datetime('now')
        """, (po["product_id"], po["quantity"]))

        # Record movement
        conn.execute("""
            INSERT INTO inventory_movements
              (product_id, movement_type, quantity_delta, reference_id, note, moved_by)
            VALUES (?, 'purchase', ?, ?, 'Purchase order received', ?)
        """, (po["product_id"], po["quantity"], po_id, session["user_id"]))

    logger.info("Purchase order id=%s received.", po_id)
    return jsonify({"success": True})


@purchases_bp.route("/<int:po_id>", methods=["DELETE"])
@require_auth(roles=["admin"])
def cancel_purchase(po_id: int):
    """DELETE (cancel) a pending purchase order."""
    with get_connection() as conn:
        po = conn.execute("SELECT id, status FROM purchases WHERE id=?", (po_id,)).fetchone()
        if not po:
            return jsonify({"error": "Purchase order not found."}), 404
        if po["status"] == "received":
            return jsonify({"error": "Cannot cancel a received order."}), 400
        conn.execute("UPDATE purchases SET status='cancelled' WHERE id=?", (po_id,))
    return jsonify({"success": True})

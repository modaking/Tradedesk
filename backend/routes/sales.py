"""
backend/routes/sales.py
========================
CRUD endpoints for Sales records.

GET  /api/sales/             — paginated list with search/filter
POST /api/sales/             — create new sale
GET  /api/sales/<id>         — single record
PUT  /api/sales/<id>         — update record
DELETE /api/sales/<id>       — delete (admin only)
"""

import logging
from flask import Blueprint, request, jsonify, session
from backend.models.database import get_connection
from backend.services.helpers import (
    require_auth, sanitize_str, sanitize_positive_int,
    sanitize_positive_float, make_reference, get_pagination_params, rows_to_list, row_to_dict,
    audit_write
)

logger = logging.getLogger(__name__)
sales_bp = Blueprint("sales", __name__)


@sales_bp.route("/", methods=["GET"])
@require_auth()
def list_sales():
    """
    GET /api/sales/?page=1&per_page=25&search=...&status=...&from_date=...&to_date=...
    Returns paginated sales records with product name joined.
    """
    search = sanitize_str(request.args.get("search", ""))
    status_filter = sanitize_str(request.args.get("status", ""))
    from_date = sanitize_str(request.args.get("from_date", ""))
    to_date = sanitize_str(request.args.get("to_date", ""))
    offset, limit = get_pagination_params()

    # Build dynamic WHERE clause — all params are bound, never interpolated
    conditions = []
    params: list = []

    if search:
        conditions.append(
            "(s.reference LIKE ? OR p.name LIKE ? OR s.customer_name LIKE ?)"
        )
        like = f"%{search}%"
        params += [like, like, like]

    if status_filter in ("completed", "pending", "cancelled"):
        conditions.append("s.status = ?")
        params.append(status_filter)

    if from_date:
        conditions.append("s.sale_date >= ?")
        params.append(from_date)

    if to_date:
        conditions.append("s.sale_date <= ?")
        params.append(to_date)

    where_sql = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    base_query = f"""
        SELECT s.*, p.name AS product_name, p.sku AS product_sku
        FROM sales s
        JOIN products p ON s.product_id = p.id
        {where_sql}
    """

    with get_connection() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) as cnt FROM ({base_query})", params
        ).fetchone()["cnt"]

        rows = conn.execute(
            f"{base_query} ORDER BY s.sale_date DESC, s.id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()

    return jsonify({
        "total": total,
        "page": request.args.get("page", 1),
        "per_page": limit,
        "records": rows_to_list(rows),
    })


@sales_bp.route("/", methods=["POST"])
@require_auth(roles=["admin", "staff"])
def create_sale():
    """
    POST /api/sales/
    Body: { product_id, quantity, unit_price, sale_date, customer_name?,
            payment_method?, salesperson?, status? }
    """
    data = request.get_json(silent=True) or {}

    product_id = sanitize_positive_int(data.get("product_id"))
    quantity = sanitize_positive_int(data.get("quantity"))
    unit_price = sanitize_positive_float(data.get("unit_price"))
    sale_date = sanitize_str(data.get("sale_date", ""))
    customer_name = sanitize_str(data.get("customer_name", ""), max_len=200)
    payment_method = sanitize_str(data.get("payment_method", "Cash"), max_len=50)
    salesperson = sanitize_str(data.get("salesperson", ""), max_len=200)
    status = sanitize_str(data.get("status", "completed"), max_len=20)

    # Validation
    errors = []
    if not product_id:
        errors.append("Product is required.")
    if quantity <= 0:
        errors.append("Quantity must be greater than 0.")
    if unit_price <= 0:
        errors.append("Unit price must be greater than 0.")
    if not sale_date:
        errors.append("Sale date is required.")
    if status not in ("completed", "pending", "cancelled"):
        errors.append("Invalid status value.")
    if errors:
        return jsonify({"success": False, "errors": errors}), 400

    # Verify product exists
    with get_connection() as conn:
        product = conn.execute(
            "SELECT id, name FROM products WHERE id = ? AND is_active = 1", (product_id,)
        ).fetchone()

    if not product:
        return jsonify({"success": False, "errors": ["Product not found."]}), 404

    # FIX: Check available stock before allowing a completed sale
    if status == "completed":
        with get_connection() as conn:
            inv = conn.execute(
                "SELECT COALESCE(quantity, 0) AS qty FROM inventory WHERE product_id = ?",
                (product_id,),
            ).fetchone()
        available = inv["qty"] if inv else 0
        if available < quantity:
            return jsonify({
                "success": False,
                "errors": [f"Insufficient stock. Available: {available}, requested: {quantity}."],
            }), 409

    reference = make_reference("TRD")

    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO sales
              (reference, product_id, quantity, unit_price, customer_name,
               payment_method, salesperson, status, sale_date, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (reference, product_id, quantity, unit_price, customer_name,
             payment_method, salesperson, status, sale_date, session["user_id"]),
        )
        sale_id = cursor.lastrowid

        # Record inventory movement only for completed sales
        if status == "completed":
            conn.execute(
                """
                INSERT INTO inventory_movements
                  (product_id, movement_type, quantity_delta, reference_id, note, moved_by)
                VALUES (?, 'sale', ?, ?, 'Sale record created', ?)
                """,
                (product_id, -quantity, sale_id, session["user_id"]),
            )
            # FIX: Use exact decrement (stock check already passed above — no silent clipping)
            conn.execute(
                """
                UPDATE inventory SET quantity = quantity - ?, updated_at = datetime('now')
                WHERE product_id = ?
                """,
                (quantity, product_id),
            )

    logger.info("Sale created: reference=%s by user_id=%s", reference, session["user_id"])
    audit_write("CREATE", "sale", sale_id, f"ref={reference} product_id={product_id} qty={quantity} status={status}")
    return jsonify({"success": True, "reference": reference, "sale_id": sale_id}), 201


@sales_bp.route("/<int:sale_id>", methods=["GET"])
@require_auth()
def get_sale(sale_id: int):
    """GET /api/sales/<id> — single sale record."""
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT s.*, p.name AS product_name, p.sku AS product_sku
            FROM sales s JOIN products p ON s.product_id = p.id
            WHERE s.id = ?
            """,
            (sale_id,),
        ).fetchone()

    if not row:
        return jsonify({"error": "Sale not found."}), 404
    return jsonify(row_to_dict(row))


@sales_bp.route("/<int:sale_id>", methods=["PUT"])
@require_auth(roles=["admin", "staff"])
def update_sale(sale_id: int):
    """PUT /api/sales/<id> — update mutable fields.

    FIX: Status transitions now correctly adjust inventory:
      pending  → completed : deduct stock (with availability check)
      completed → cancelled : restore stock
      pending  → cancelled : no inventory change (never deducted)
    """
    data = request.get_json(silent=True) or {}

    with get_connection() as conn:
        existing = conn.execute(
            "SELECT id, product_id, quantity, status FROM sales WHERE id = ?", (sale_id,)
        ).fetchone()
    if not existing:
        return jsonify({"error": "Sale not found."}), 404

    old_status = existing["status"]
    product_id = existing["product_id"]
    quantity = existing["quantity"]

    customer_name = sanitize_str(data.get("customer_name", ""), max_len=200)
    payment_method = sanitize_str(data.get("payment_method", "Cash"), max_len=50)
    salesperson = sanitize_str(data.get("salesperson", ""), max_len=200)
    new_status = sanitize_str(data.get("status", old_status), max_len=20)
    sale_date = sanitize_str(data.get("sale_date", ""))

    if new_status not in ("completed", "pending", "cancelled"):
        return jsonify({"error": "Invalid status."}), 400

    # Date validation: staff can only use today's date; admins may backdate
    if sale_date:
        from datetime import date as _date
        today_str = _date.today().isoformat()
        if session.get("role") != "admin" and sale_date != today_str:
            return jsonify({"error": "Only admins can change the sale date to a past or future date."}), 403

    with get_connection() as conn:
        # --- Inventory adjustments for status transitions ---
        if old_status != new_status:

            # pending → completed: need to deduct stock (check availability first)
            if old_status == "pending" and new_status == "completed":
                inv = conn.execute(
                    "SELECT COALESCE(quantity, 0) AS qty FROM inventory WHERE product_id = ?",
                    (product_id,),
                ).fetchone()
                available = inv["qty"] if inv else 0
                if available < quantity:
                    return jsonify({
                        "error": f"Insufficient stock to complete sale. "
                                 f"Available: {available}, required: {quantity}."
                    }), 409
                conn.execute(
                    "UPDATE inventory SET quantity = quantity - ?, updated_at = datetime('now') "
                    "WHERE product_id = ?",
                    (quantity, product_id),
                )
                conn.execute(
                    "INSERT INTO inventory_movements "
                    "  (product_id, movement_type, quantity_delta, reference_id, note, moved_by) "
                    "VALUES (?, 'sale', ?, ?, 'Sale marked completed', ?)",
                    (product_id, -quantity, sale_id, session["user_id"]),
                )

            # completed → cancelled: restore stock
            elif old_status == "completed" and new_status == "cancelled":
                conn.execute(
                    "UPDATE inventory SET quantity = quantity + ?, updated_at = datetime('now') "
                    "WHERE product_id = ?",
                    (quantity, product_id),
                )
                conn.execute(
                    "INSERT INTO inventory_movements "
                    "  (product_id, movement_type, quantity_delta, reference_id, note, moved_by) "
                    "VALUES (?, 'adjustment', ?, ?, 'Sale cancelled — stock restored', ?)",
                    (product_id, quantity, sale_id, session["user_id"]),
                )
            # pending → cancelled or cancelled → * : no inventory action needed

        conn.execute(
            """
            UPDATE sales SET customer_name=?, payment_method=?, salesperson=?,
                             status=?, sale_date=?
            WHERE id=?
            """,
            (customer_name, payment_method, salesperson, new_status, sale_date, sale_id),
        )

    return jsonify({"success": True})


@sales_bp.route("/<int:sale_id>", methods=["DELETE"])
@require_auth(roles=["admin"])
def delete_sale(sale_id: int):
    """DELETE /api/sales/<id> — admin only.

    FIX: Restores inventory if the deleted sale was completed.
    """
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, product_id, quantity, status FROM sales WHERE id = ?", (sale_id,)
        ).fetchone()
        if not row:
            return jsonify({"error": "Sale not found."}), 404

        # Restore stock for completed sales that are being hard-deleted
        if row["status"] == "completed":
            conn.execute(
                "UPDATE inventory SET quantity = quantity + ?, updated_at = datetime('now') "
                "WHERE product_id = ?",
                (row["quantity"], row["product_id"]),
            )
            conn.execute(
                "INSERT INTO inventory_movements "
                "  (product_id, movement_type, quantity_delta, reference_id, note, moved_by) "
                "VALUES (?, 'adjustment', ?, ?, 'Sale record deleted — stock restored', ?)",
                (row["product_id"], row["quantity"], row["id"], session["user_id"]),
            )

        conn.execute("DELETE FROM sales WHERE id = ?", (sale_id,))

    logger.info("Sale id=%s deleted by user_id=%s", sale_id, session["user_id"])
    audit_write("DELETE", "sale", sale_id, f"status was {row['status']}")
    return jsonify({"success": True})

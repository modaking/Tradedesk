"""
backend/routes/dashboard.py
============================
Dashboard KPI summary endpoint.

GET /api/dashboard/summary  — key stats for the dashboard overview
"""

import logging
from flask import Blueprint, jsonify
from backend.models.database import get_connection
from backend.services.helpers import require_auth, row_to_dict

logger = logging.getLogger(__name__)
dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.route("/summary", methods=["GET"])
@require_auth()
def summary():
    """Return KPIs: revenue, orders, low stock count, recent sales, events."""
    with get_connection() as conn:
        # Total revenue this month
        revenue = conn.execute("""
            SELECT COALESCE(SUM(total_amount), 0) AS total
            FROM sales
            WHERE status='completed'
              AND strftime('%Y-%m', sale_date) = strftime('%Y-%m', 'now')
        """).fetchone()

        # Total orders this month
        orders = conn.execute("""
            SELECT COUNT(*) AS cnt FROM sales
            WHERE strftime('%Y-%m', sale_date) = strftime('%Y-%m', 'now')
        """).fetchone()

        # Low stock count
        low_stock = conn.execute("""
            SELECT COUNT(*) as cnt FROM products p
            LEFT JOIN inventory i ON i.product_id = p.id
            WHERE p.is_active=1 AND COALESCE(i.quantity,0) <= p.reorder_point
              AND COALESCE(i.quantity,0) > 0
        """).fetchone()

        out_of_stock = conn.execute("""
            SELECT COUNT(*) as cnt FROM products p
            LEFT JOIN inventory i ON i.product_id = p.id
            WHERE p.is_active=1 AND COALESCE(i.quantity,0) = 0
        """).fetchone()

        # Recent sales (last 5)
        recent_sales = conn.execute("""
            SELECT s.reference, s.total_amount, s.status, s.sale_date,
                   s.customer_name, p.name AS product_name
            FROM sales s JOIN products p ON s.product_id = p.id
            ORDER BY s.created_at DESC LIMIT 5
        """).fetchall()

        # Recent import logs (last 5)
        recent_imports = conn.execute("""
            SELECT filename, import_type, success_rows, failed_rows, imported_at
            FROM excel_import_logs ORDER BY imported_at DESC LIMIT 5
        """).fetchall()

        # Unique customers this month
        customers = conn.execute("""
            SELECT COUNT(DISTINCT customer_name) AS cnt FROM sales
            WHERE customer_name != ''
              AND strftime('%Y-%m', sale_date) = strftime('%Y-%m', 'now')
        """).fetchone()

    return jsonify({
        "revenue_this_month": revenue["total"],
        "orders_this_month": orders["cnt"],
        "low_stock_count": low_stock["cnt"],
        "out_of_stock_count": out_of_stock["cnt"],
        "unique_customers": customers["cnt"],
        "recent_sales": [dict(r) for r in recent_sales],
        "recent_imports": [dict(r) for r in recent_imports],
    })

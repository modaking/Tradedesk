"""
backend/routes/reports.py
==========================
Chart data endpoints — all return JSON arrays suitable for Chart.js.

GET /api/reports/daily-sales        — last 14 days revenue
GET /api/reports/monthly-revenue    — last 12 months revenue
GET /api/reports/sales-by-product   — top 10 products by revenue
GET /api/reports/sales-by-category  — revenue grouped by category
GET /api/reports/stock-levels       — current stock per category
GET /api/reports/top-selling        — top 10 selling products by quantity
GET /api/reports/inventory-value    — inventory value per category
"""

import logging
from flask import Blueprint, request, jsonify
from backend.models.database import get_connection
from backend.services.helpers import require_auth, rows_to_list, sanitize_str

logger = logging.getLogger(__name__)
reports_bp = Blueprint("reports", __name__)


@reports_bp.route("/daily-sales", methods=["GET"])
@require_auth(roles=["admin"])
def daily_sales():
    """Last N days of completed sales revenue, suitable for a line chart."""
    days = min(90, max(7, int(request.args.get("days", 14))))
    # FIX: Build cutoff date in Python — no user input interpolated into SQL
    from datetime import date, timedelta
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT sale_date AS label,
                   COALESCE(SUM(total_amount), 0) AS value,
                   COUNT(*) AS count
            FROM sales
            WHERE status='completed'
              AND sale_date >= ?
            GROUP BY sale_date
            ORDER BY sale_date ASC
        """, (cutoff,)).fetchall()
    return jsonify(rows_to_list(rows))


@reports_bp.route("/monthly-revenue", methods=["GET"])
@require_auth(roles=["admin"])
def monthly_revenue():
    """Last 12 months of revenue, suitable for a bar chart."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT strftime('%Y-%m', sale_date) AS label,
                   COALESCE(SUM(total_amount), 0) AS value,
                   COUNT(*) AS count
            FROM sales
            WHERE status='completed'
              AND sale_date >= date('now', '-12 months')
            GROUP BY label
            ORDER BY label ASC
        """).fetchall()
    return jsonify(rows_to_list(rows))


@reports_bp.route("/sales-by-product", methods=["GET"])
@require_auth(roles=["admin"])
def sales_by_product():
    """Top 10 products by revenue (current month), for a bar chart."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT p.name AS label,
                   COALESCE(SUM(s.total_amount), 0) AS value,
                   COALESCE(SUM(s.quantity), 0) AS quantity
            FROM sales s JOIN products p ON s.product_id = p.id
            WHERE s.status='completed'
              AND strftime('%Y-%m', s.sale_date) = strftime('%Y-%m', 'now')
            GROUP BY p.id
            ORDER BY value DESC LIMIT 10
        """).fetchall()
    return jsonify(rows_to_list(rows))


@reports_bp.route("/sales-by-category", methods=["GET"])
@require_auth(roles=["admin"])
def sales_by_category():
    """Revenue grouped by product category (current month), for a doughnut."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT p.category AS label,
                   COALESCE(SUM(s.total_amount), 0) AS value
            FROM sales s JOIN products p ON s.product_id = p.id
            WHERE s.status='completed'
              AND strftime('%Y-%m', s.sale_date) = strftime('%Y-%m', 'now')
            GROUP BY p.category
            ORDER BY value DESC
        """).fetchall()
    return jsonify(rows_to_list(rows))


@reports_bp.route("/stock-levels", methods=["GET"])
@require_auth(roles=["admin"])
def stock_levels():
    """Current stock quantity grouped by category, for a bar chart."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT p.category AS label,
                   COALESCE(SUM(i.quantity), 0) AS value
            FROM products p LEFT JOIN inventory i ON i.product_id = p.id
            WHERE p.is_active=1
            GROUP BY p.category
            ORDER BY value DESC
        """).fetchall()
    return jsonify(rows_to_list(rows))


@reports_bp.route("/top-selling", methods=["GET"])
@require_auth(roles=["admin"])
def top_selling():
    """Top 10 products by quantity sold (all time), for a horizontal bar."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT p.name AS label,
                   COALESCE(SUM(s.quantity), 0) AS value
            FROM sales s JOIN products p ON s.product_id = p.id
            WHERE s.status='completed'
            GROUP BY p.id ORDER BY value DESC LIMIT 10
        """).fetchall()
    return jsonify(rows_to_list(rows))


@reports_bp.route("/inventory-value", methods=["GET"])
@require_auth(roles=["admin"])
def inventory_value():
    """Inventory value (quantity × cost_price) per category, for a doughnut."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT p.category AS label,
                   COALESCE(SUM(i.quantity * p.cost_price), 0) AS value
            FROM products p LEFT JOIN inventory i ON i.product_id = p.id
            WHERE p.is_active=1
            GROUP BY p.category ORDER BY value DESC
        """).fetchall()
    return jsonify(rows_to_list(rows))


@reports_bp.route("/profit-summary", methods=["GET"])
@require_auth(roles=["admin"])
def profit_summary():
    """Overall profit KPIs: revenue, cost, gross profit, margin — for a date range or last 12 months."""
    from_date = sanitize_str(request.args.get("from_date", ""), max_len=10)
    to_date   = sanitize_str(request.args.get("to_date", ""), max_len=10)

    conditions = ["s.status='completed'"]
    params: list = []
    if from_date: conditions.append("s.sale_date >= ?"); params.append(from_date)
    if to_date:   conditions.append("s.sale_date <= ?"); params.append(to_date)
    where = "WHERE " + " AND ".join(conditions)

    with get_connection() as conn:
        row = conn.execute(f"""
            SELECT
              COALESCE(SUM(s.total_amount), 0)               AS revenue,
              COALESCE(SUM(s.quantity * p.cost_price), 0)    AS cogs,
              COALESCE(SUM(s.total_amount
                           - s.quantity * p.cost_price), 0)  AS gross_profit,
              COUNT(*)                                        AS transactions,
              COALESCE(SUM(s.quantity), 0)                   AS units_sold,
              COUNT(DISTINCT s.customer_name)                 AS unique_customers
            FROM sales s
            JOIN products p ON s.product_id = p.id
            {where}
        """, params).fetchone()

        # Previous period for comparison (same window length, shifted back)
        prev_row = conn.execute(f"""
            SELECT COALESCE(SUM(s.total_amount), 0)            AS revenue,
                   COALESCE(SUM(s.total_amount
                                - s.quantity * p.cost_price), 0) AS gross_profit
            FROM sales s JOIN products p ON s.product_id = p.id
            WHERE s.status='completed'
              AND s.sale_date >= date(COALESCE(?, date('now','-12 months')), '-12 months')
              AND s.sale_date <  COALESCE(?, date('now','-12 months'))
        """, [from_date or None, from_date or None]).fetchone()

    result = dict(row)
    result["margin_pct"] = round(
        result["gross_profit"] / result["revenue"] * 100, 2
    ) if result["revenue"] else 0
    result["prev_revenue"]      = prev_row["revenue"]
    result["prev_gross_profit"] = prev_row["gross_profit"]
    result["revenue_change_pct"] = round(
        (result["revenue"] - prev_row["revenue"]) / prev_row["revenue"] * 100, 1
    ) if prev_row["revenue"] else None
    return jsonify(result)


@reports_bp.route("/monthly-profit", methods=["GET"])
@require_auth(roles=["admin"])
def monthly_profit():
    """Month-by-month revenue vs COGS vs gross profit for the last 12 months."""
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT strftime('%Y-%m', s.sale_date)            AS label,
                   ROUND(SUM(s.total_amount), 2)             AS revenue,
                   ROUND(SUM(s.quantity * p.cost_price), 2)  AS cogs,
                   ROUND(SUM(s.total_amount
                              - s.quantity * p.cost_price), 2) AS gross_profit,
                   COUNT(*)                                   AS transactions
            FROM sales s JOIN products p ON s.product_id = p.id
            WHERE s.status='completed'
              AND s.sale_date >= date('now', '-12 months')
            GROUP BY label ORDER BY label ASC
        """).fetchall()
    return jsonify(rows_to_list(rows))


@reports_bp.route("/product-profitability", methods=["GET"])
@require_auth(roles=["admin"])
def product_profitability():
    """Per-product: revenue, COGS, gross profit, margin % — top 15 by profit."""
    from_date = sanitize_str(request.args.get("from_date", ""), max_len=10)
    to_date   = sanitize_str(request.args.get("to_date", ""), max_len=10)
    conditions = ["s.status='completed'"]
    params: list = []
    if from_date: conditions.append("s.sale_date >= ?"); params.append(from_date)
    if to_date:   conditions.append("s.sale_date <= ?"); params.append(to_date)
    where = "WHERE " + " AND ".join(conditions)
    with get_connection() as conn:
        rows = conn.execute(f"""
            SELECT p.name                                            AS label,
                   p.sku,
                   p.category,
                   ROUND(SUM(s.total_amount), 2)                    AS revenue,
                   ROUND(SUM(s.quantity * p.cost_price), 2)         AS cogs,
                   ROUND(SUM(s.total_amount
                              - s.quantity * p.cost_price), 2)       AS gross_profit,
                   ROUND(SUM(s.total_amount
                              - s.quantity * p.cost_price)
                         / NULLIF(SUM(s.total_amount),0) * 100, 1)  AS margin_pct,
                   SUM(s.quantity)                                   AS units_sold
            FROM sales s JOIN products p ON s.product_id = p.id
            {where}
            GROUP BY p.id
            ORDER BY gross_profit DESC LIMIT 15
        """, params).fetchall()
    return jsonify(rows_to_list(rows))


@reports_bp.route("/category-profitability", methods=["GET"])
@require_auth(roles=["admin"])
def category_profitability():
    """Per-category: revenue, COGS, gross profit, margin %."""
    from_date = sanitize_str(request.args.get("from_date", ""), max_len=10)
    to_date   = sanitize_str(request.args.get("to_date", ""), max_len=10)
    conditions = ["s.status='completed'"]
    params: list = []
    if from_date: conditions.append("s.sale_date >= ?"); params.append(from_date)
    if to_date:   conditions.append("s.sale_date <= ?"); params.append(to_date)
    where = "WHERE " + " AND ".join(conditions)
    with get_connection() as conn:
        rows = conn.execute(f"""
            SELECT p.category                                        AS label,
                   ROUND(SUM(s.total_amount), 2)                    AS revenue,
                   ROUND(SUM(s.quantity * p.cost_price), 2)         AS cogs,
                   ROUND(SUM(s.total_amount
                              - s.quantity * p.cost_price), 2)       AS gross_profit,
                   ROUND(SUM(s.total_amount
                              - s.quantity * p.cost_price)
                         / NULLIF(SUM(s.total_amount),0) * 100, 1)  AS margin_pct
            FROM sales s JOIN products p ON s.product_id = p.id
            {where}
            GROUP BY p.category ORDER BY gross_profit DESC
        """, params).fetchall()
    return jsonify(rows_to_list(rows))


@reports_bp.route("/salesperson-performance", methods=["GET"])
@require_auth(roles=["admin"])
def salesperson_performance():
    """Per-salesperson: transactions, units, revenue, gross profit."""
    from_date = sanitize_str(request.args.get("from_date", ""), max_len=10)
    to_date   = sanitize_str(request.args.get("to_date", ""), max_len=10)
    conditions = ["s.status='completed'", "s.salesperson != ''"]
    params: list = []
    if from_date: conditions.append("s.sale_date >= ?"); params.append(from_date)
    if to_date:   conditions.append("s.sale_date <= ?"); params.append(to_date)
    where = "WHERE " + " AND ".join(conditions)
    with get_connection() as conn:
        rows = conn.execute(f"""
            SELECT COALESCE(NULLIF(s.salesperson,''), 'Unknown')     AS label,
                   COUNT(*)                                          AS transactions,
                   SUM(s.quantity)                                   AS units_sold,
                   ROUND(SUM(s.total_amount), 2)                    AS revenue,
                   ROUND(SUM(s.total_amount
                              - s.quantity * p.cost_price), 2)       AS gross_profit,
                   ROUND(AVG(s.total_amount), 2)                    AS avg_sale_value
            FROM sales s JOIN products p ON s.product_id = p.id
            {where}
            GROUP BY s.salesperson ORDER BY revenue DESC LIMIT 20
        """, params).fetchall()
    return jsonify(rows_to_list(rows))


@reports_bp.route("/customer-insights", methods=["GET"])
@require_auth(roles=["admin"])
def customer_insights():
    """Top customers by revenue plus repeat vs new breakdown."""
    from_date = sanitize_str(request.args.get("from_date", ""), max_len=10)
    to_date   = sanitize_str(request.args.get("to_date", ""), max_len=10)
    conditions = ["s.status='completed'", "s.customer_name != ''"]
    params: list = []
    if from_date: conditions.append("s.sale_date >= ?"); params.append(from_date)
    if to_date:   conditions.append("s.sale_date <= ?"); params.append(to_date)
    where = "WHERE " + " AND ".join(conditions)
    with get_connection() as conn:
        top = conn.execute(f"""
            SELECT s.customer_name                  AS label,
                   COUNT(*)                         AS transactions,
                   ROUND(SUM(s.total_amount), 2)   AS revenue,
                   ROUND(AVG(s.total_amount), 2)   AS avg_order_value,
                   MIN(s.sale_date)                 AS first_purchase,
                   MAX(s.sale_date)                 AS last_purchase
            FROM sales s {where}
            GROUP BY s.customer_name
            ORDER BY revenue DESC LIMIT 15
        """, params).fetchall()

        # FIX: subquery must alias the table and use the same WHERE clause properly.
        # Build a separate where clause without the table alias for the subquery.
        sub_conditions = ["status='completed'", "customer_name != ''"]
        sub_params: list = []
        if from_date: sub_conditions.append("sale_date >= ?"); sub_params.append(from_date)
        if to_date:   sub_conditions.append("sale_date <= ?"); sub_params.append(to_date)
        sub_where = "WHERE " + " AND ".join(sub_conditions)

        breakdown = conn.execute(f"""
            SELECT
              SUM(CASE WHEN cnt > 1 THEN 1 ELSE 0 END) AS repeat_customers,
              SUM(CASE WHEN cnt = 1 THEN 1 ELSE 0 END) AS one_time_customers
            FROM (
              SELECT customer_name, COUNT(*) AS cnt
              FROM sales
              {sub_where}
              GROUP BY customer_name
            )
        """, sub_params).fetchone()

    return jsonify({
        "top_customers": rows_to_list(top),
        "repeat_customers": breakdown["repeat_customers"] or 0,
        "one_time_customers": breakdown["one_time_customers"] or 0,
    })


@reports_bp.route("/payment-breakdown", methods=["GET"])
@require_auth(roles=["admin"])
def payment_breakdown():
    """Revenue split by payment method."""
    from_date = sanitize_str(request.args.get("from_date", ""), max_len=10)
    to_date   = sanitize_str(request.args.get("to_date", ""), max_len=10)
    conditions = ["status='completed'"]
    params: list = []
    if from_date: conditions.append("sale_date >= ?"); params.append(from_date)
    if to_date:   conditions.append("sale_date <= ?"); params.append(to_date)
    where = "WHERE " + " AND ".join(conditions)
    with get_connection() as conn:
        rows = conn.execute(f"""
            SELECT COALESCE(NULLIF(payment_method,''), 'Unknown') AS label,
                   COUNT(*)                         AS transactions,
                   ROUND(SUM(total_amount), 2)      AS value
            FROM sales {where}
            GROUP BY payment_method ORDER BY value DESC
        """, params).fetchall()
    return jsonify(rows_to_list(rows))


@reports_bp.route("/export", methods=["GET"])
@require_auth(roles=["admin"])
def export_report():
    """GET /api/reports/export?type=sales|inventory|products&from_date=...&to_date=...
    Returns a downloadable Excel report."""
    import io
    import pandas as pd
    from flask import send_file
    from datetime import datetime

    report_type = sanitize_str(request.args.get("type", "sales"), max_len=20)
    from_date = sanitize_str(request.args.get("from_date", ""), max_len=10)
    to_date = sanitize_str(request.args.get("to_date", ""), max_len=10)

    if report_type not in ("sales", "inventory", "products", "summary"):
        return jsonify({"error": "Invalid report type."}), 400

    buf = io.BytesIO()

    with get_connection() as conn:
        if report_type == "sales":
            params = []
            conditions = ["s.status = 'completed'"]
            if from_date:
                conditions.append("s.sale_date >= ?"); params.append(from_date)
            if to_date:
                conditions.append("s.sale_date <= ?"); params.append(to_date)
            where = "WHERE " + " AND ".join(conditions)
            rows = conn.execute(f"""
                SELECT s.reference, s.sale_date, p.name AS product, p.sku,
                       s.quantity, s.unit_price,
                       s.total_amount, s.customer_name, s.payment_method,
                       s.salesperson, s.status
                FROM sales s JOIN products p ON s.product_id = p.id
                {where} ORDER BY s.sale_date DESC
            """, params).fetchall()
            df = pd.DataFrame([dict(r) for r in rows])
            if not df.empty:
                df.columns = ["Reference","Date","Product","SKU","Qty","Unit Price (KES)","Total (KES)","Customer","Payment","Salesperson","Status"]

        elif report_type == "inventory":
            rows = conn.execute("""
                SELECT p.sku, p.name, p.category, COALESCE(i.quantity,0) AS quantity,
                       p.reorder_point, COALESCE(i.location,'Main Warehouse') AS location,
                       p.cost_price, p.sell_price,
                       (COALESCE(i.quantity,0)*p.cost_price) AS stock_value,
                       CASE WHEN COALESCE(i.quantity,0)=0 THEN 'Out of Stock'
                            WHEN COALESCE(i.quantity,0)<p.reorder_point THEN 'Low Stock'
                            ELSE 'In Stock' END AS status
                FROM products p LEFT JOIN inventory i ON i.product_id=p.id
                WHERE p.is_active=1 ORDER BY p.name
            """).fetchall()
            df = pd.DataFrame([dict(r) for r in rows])
            if not df.empty:
                df.columns = ["SKU","Product","Category","Qty","Reorder Pt","Location","Cost Price (KES)","Sell Price (KES)","Stock Value (KES)","Status"]

        elif report_type == "products":
            rows = conn.execute("""
                SELECT p.sku, p.name, p.category, p.sell_price, p.cost_price,
                       p.reorder_point, COALESCE(i.quantity,0) AS stock,
                       CASE WHEN p.cost_price>0 THEN ROUND((p.sell_price-p.cost_price)/p.sell_price*100,2) ELSE NULL END AS margin_pct,
                       CASE WHEN p.is_active=1 THEN 'Active' ELSE 'Inactive' END AS status
                FROM products p LEFT JOIN inventory i ON i.product_id=p.id
                ORDER BY p.name
            """).fetchall()
            df = pd.DataFrame([dict(r) for r in rows])
            if not df.empty:
                df.columns = ["SKU","Name","Category","Sell Price (KES)","Cost Price (KES)","Reorder Pt","Stock Qty","Margin %","Status"]

        elif report_type == "summary":
            # Multi-sheet summary
            monthly = conn.execute("""
                SELECT strftime('%Y-%m', sale_date) AS Month,
                       COUNT(*) AS Transactions,
                       SUM(quantity) AS Units_Sold,
                       ROUND(SUM(total_amount),2) AS Revenue_KES
                FROM sales WHERE status='completed'
                GROUP BY Month ORDER BY Month DESC LIMIT 24
            """).fetchall()
            top_prods = conn.execute("""
                SELECT p.name AS Product, p.sku AS SKU,
                       SUM(s.quantity) AS Units_Sold,
                       ROUND(SUM(s.total_amount),2) AS Revenue_KES
                FROM sales s JOIN products p ON s.product_id=p.id
                WHERE s.status='completed'
                GROUP BY p.id ORDER BY Revenue_KES DESC LIMIT 20
            """).fetchall()
            inv_summary = conn.execute("""
                SELECT p.category AS Category,
                       COUNT(*) AS Products,
                       SUM(COALESCE(i.quantity,0)) AS Total_Units,
                       ROUND(SUM(COALESCE(i.quantity,0)*p.cost_price),2) AS Stock_Value_KES
                FROM products p LEFT JOIN inventory i ON i.product_id=p.id
                WHERE p.is_active=1 GROUP BY p.category ORDER BY Stock_Value_KES DESC
            """).fetchall()

            with pd.ExcelWriter(buf, engine="openpyxl") as writer:
                pd.DataFrame([dict(r) for r in monthly]).to_excel(writer, index=False, sheet_name="Monthly Revenue")
                pd.DataFrame([dict(r) for r in top_prods]).to_excel(writer, index=False, sheet_name="Top Products")
                pd.DataFrame([dict(r) for r in inv_summary]).to_excel(writer, index=False, sheet_name="Inventory by Category")

                # Profit by product
                profit_rows = conn.execute("""
                    SELECT p.name AS Product, p.sku AS SKU,
                           ROUND(SUM(s.total_amount),2) AS Revenue_KES,
                           ROUND(SUM(s.quantity*p.cost_price),2) AS COGS_KES,
                           ROUND(SUM(s.total_amount - s.quantity*p.cost_price),2) AS Gross_Profit_KES,
                           ROUND(SUM(s.total_amount - s.quantity*p.cost_price)
                                 / NULLIF(SUM(s.total_amount),0)*100,1) AS Margin_Pct
                    FROM sales s JOIN products p ON s.product_id=p.id
                    WHERE s.status='completed'
                    GROUP BY p.id ORDER BY Gross_Profit_KES DESC
                """).fetchall()
                pd.DataFrame([dict(r) for r in profit_rows]).to_excel(writer, index=False, sheet_name="Product Profitability")
            buf.seek(0)
            fname = f"tradedesk_summary_report_{datetime.now().strftime('%Y%m%d')}.xlsx"
            return send_file(buf, as_attachment=True, download_name=fname,
                             mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        if df.empty:
            pd.DataFrame([{"Note": "No data found for the selected filters."}]).to_excel(writer, index=False, sheet_name="Report")
        else:
            df.to_excel(writer, index=False, sheet_name="Report")

    buf.seek(0)
    date_suffix = f"_{from_date}_to_{to_date}" if from_date or to_date else f"_{datetime.now().strftime('%Y%m%d')}"
    fname = f"tradedesk_{report_type}_report{date_suffix}.xlsx"
    return send_file(buf, as_attachment=True, download_name=fname,
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

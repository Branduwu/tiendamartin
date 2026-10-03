import { PostgresInventory } from "./database";
import {
  PermissionDeniedError,
  mexicoDate,
  reportFilters,
  type ReportFilters,
  type ReportOptions,
  type ReportingQueries,
  type OperationalReport,
  type SalesMetrics,
} from "@smartretail/application";

// Fixed SQL, parameterized references. A product/payment filter selects whole
// transactions containing that product/method; it never allocates split payments.
const saleScope = `s.tenant_id=$1 AND ($4::uuid IS NULL OR s.location_id=$4)
 AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM retail.sale_lines l WHERE l.tenant_id=s.tenant_id AND l.sale_id=s.id AND l.product_id=$5))
 AND ($6::uuid IS NULL OR s.customer_id=$6)
 AND ($7::text IS NULL OR EXISTS(SELECT 1 FROM retail.sale_payments p WHERE p.tenant_id=s.tenant_id AND p.sale_id=s.id AND p.method=$7))`;
const bounds = `b AS (SELECT $2::date::timestamp AT TIME ZONE 'America/Mexico_City' AS start,
 ($3::date+1)::timestamp AT TIME ZONE 'America/Mexico_City' AS finish,
 $8::date::timestamp AT TIME ZONE 'America/Mexico_City' AS today,
 ($8::date+1)::timestamp AT TIME ZONE 'America/Mexico_City' AS tomorrow)`;
const salesSql = `WITH ${bounds},
 ss AS (SELECT s.*, (s.created_at AT TIME ZONE 'America/Mexico_City')::date AS day,
 coalesce((SELECT sum(p.amount_minor_units) FROM retail.sale_payments p WHERE p.tenant_id=s.tenant_id AND p.sale_id=s.id AND p.method='cash'),0) AS cash,
 coalesce((SELECT sum(p.amount_minor_units) FROM retail.sale_payments p WHERE p.tenant_id=s.tenant_id AND p.sale_id=s.id AND p.method='card'),0) AS card
 FROM retail.sales s,b WHERE ${saleScope} AND ((s.created_at>=b.start AND s.created_at<b.finish) OR (s.created_at>=b.today AND s.created_at<b.tomorrow))),
 rr AS (SELECT r.*, (r.created_at AT TIME ZONE 'America/Mexico_City')::date AS day
 FROM retail.sale_returns r JOIN retail.sales s ON s.tenant_id=r.tenant_id AND s.id=r.sale_id CROSS JOIN b
 WHERE ${saleScope.replace("AND ($4::uuid IS NULL OR s.location_id=$4)", "")} AND ($4::uuid IS NULL OR r.location_id=$4)
 AND ((r.created_at>=b.start AND r.created_at<b.finish) OR (r.created_at>=b.today AND r.created_at<b.tomorrow))),
 buckets AS (SELECT 'period' AS key,$2::date AS lo,$3::date AS hi
 UNION ALL SELECT 'today',$8::date,$8::date
 UNION ALL SELECT to_char(d,'YYYY-MM-DD'),d::date,d::date FROM generate_series($2::date::timestamp,$3::date::timestamp,'1 day') d),
 totals AS (SELECT key,
 coalesce(sum(total_minor_units),0) AS gross,count(s.id)::numeric AS count,coalesce(sum(cash),0) AS cash,coalesce(sum(card),0) AS card,
 count(DISTINCT customer_id)::text AS customers,count(s.id) FILTER(WHERE customer_id IS NOT NULL)::text AS associated,count(s.id) FILTER(WHERE customer_id IS NULL)::text AS general,
 (SELECT coalesce(sum(r.total_minor_units),0) FROM rr r WHERE r.day BETWEEN k.lo AND k.hi) AS refunds
 FROM buckets k LEFT JOIN ss s ON s.day BETWEEN k.lo AND k.hi GROUP BY k.key,k.lo,k.hi)
 SELECT key,gross::text,count::text,CASE WHEN count=0 THEN '0' ELSE div(gross+div(count,2),count)::text END AS average,
 cash::text,card::text,refunds::text,(gross-refunds)::text AS net,customers,associated,general FROM totals ORDER BY key`;
const stock = `stock AS (SELECT p.id,p.name,p.unit,p.status,coalesce(sum(b.milli_units),0) AS stock
 FROM retail.products p LEFT JOIN retail.stock_balances b ON b.tenant_id=p.tenant_id AND b.product_id=p.id AND ($4::uuid IS NULL OR b.location_id=$4)
 WHERE p.tenant_id=$1 AND ($5::uuid IS NULL OR p.id=$5) GROUP BY p.id,p.name,p.unit,p.status)`;
const productsSql = `WITH ${bounds},${stock}, sold AS (
 SELECT l.product_id,sum(l.quantity_milli_units) AS quantity,sum(l.line_total_minor_units) AS revenue
 FROM retail.sales s JOIN retail.sale_lines l ON l.tenant_id=s.tenant_id AND l.sale_id=s.id CROSS JOIN b
 WHERE ${saleScope} AND s.created_at>=b.start AND s.created_at<b.finish AND ($5::uuid IS NULL OR l.product_id=$5)
 GROUP BY l.product_id ORDER BY sum(l.line_total_minor_units) DESC,l.product_id LIMIT 20)
 SELECT p.id,p.name,p.unit,d.quantity::text,d.revenue::text,coalesce(st.stock,0)::text AS stock FROM sold d
 JOIN retail.products p ON p.tenant_id=$1 AND p.id=d.product_id LEFT JOIN stock st ON st.id=p.id ORDER BY d.revenue DESC,p.id`;
const inventorySql = `WITH ${stock} SELECT
 (SELECT count(*)::text FROM stock WHERE status='active' AND stock>0 AND stock<=$9::numeric) AS low,
 (SELECT count(*)::text FROM stock WHERE status='active' AND stock=0) AS empty,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'unit',unit,'stock',stock::text) ORDER BY stock,id)
 FROM (SELECT * FROM stock WHERE status='active' AND stock<=$9::numeric ORDER BY stock,id LIMIT 100) a),'[]'::jsonb) AS alerts`;
const purchaseScope = `o.tenant_id=$1 AND ($4::uuid IS NULL OR o.location_id=$4) AND ($10::uuid IS NULL OR o.supplier_id=$10)
 AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM retail.purchase_order_lines l WHERE l.tenant_id=o.tenant_id AND l.purchase_id=o.id AND l.product_id=$5))`;
const purchasesSql = `WITH ${bounds}, orders AS (
 SELECT o.* FROM retail.purchase_orders o,b WHERE ${purchaseScope} AND o.created_at>=b.start AND o.created_at<b.finish),
 receipts AS (SELECT r.* FROM retail.purchase_receipts r JOIN retail.purchase_orders o ON o.tenant_id=r.tenant_id AND o.id=r.purchase_id CROSS JOIN b
 WHERE ${purchaseScope} AND r.created_at>=b.start AND r.created_at<b.finish)
 SELECT count(*)::text AS created,count(*) FILTER(WHERE status='ordered')::text AS pending,
 count(*) FILTER(WHERE status='partially_received')::text AS partial,count(*) FILTER(WHERE status='received')::text AS received,
 (SELECT coalesce(sum(div(l.unit_cost::numeric*l.quantity_ordered+500,1000)),0)::text FROM orders o JOIN retail.purchase_order_lines l ON l.tenant_id=o.tenant_id AND l.purchase_id=o.id WHERE o.status<>'cancelled') AS "orderedAmount",
 (SELECT coalesce(sum(div(p.unit_cost::numeric*l.quantity+500,1000)),0)::text FROM receipts r JOIN retail.purchase_receipt_lines l ON l.tenant_id=r.tenant_id AND l.receipt_id=r.id JOIN retail.purchase_order_lines p ON p.tenant_id=l.tenant_id AND p.purchase_id=l.purchase_id AND p.product_id=l.product_id) AS "receivedAmount"
 FROM orders`;
// Open expected cash uses the existing ledger projection; closed values use
// immutable recorded snapshots. Refund cash_out is already in that ledger.
const cashSql = `WITH ${bounds}, shifts AS (SELECT c.* FROM retail.cash_register_shifts c,b WHERE c.tenant_id=$1
 AND ($4::uuid IS NULL OR c.location_id=$4) AND c.opened_at>=b.start AND c.opened_at<b.finish),
 moves AS (SELECT m.* FROM retail.cash_movements m JOIN retail.cash_register_shifts c ON c.tenant_id=m.tenant_id AND c.id=m.shift_id CROSS JOIN b
 WHERE m.tenant_id=$1 AND ($4::uuid IS NULL OR c.location_id=$4) AND m.created_at>=b.start AND m.created_at<b.finish)
 SELECT count(*) FILTER(WHERE status='open')::text AS open,count(*) FILTER(WHERE status='closed')::text AS closed,
 coalesce(sum(CASE WHEN status='closed' THEN expected_cash::numeric ELSE retail.cash_expected(id) END),0)::text AS expected,
 coalesce(sum(CASE WHEN difference<0 THEN -difference::numeric ELSE 0 END),0)::text AS shortage,
 coalesce(sum(CASE WHEN difference>0 THEN difference::numeric ELSE 0 END),0)::text AS surplus,
 (SELECT coalesce(sum(amount),0)::text FROM moves WHERE type='cash_in') AS "cashIn",
 (SELECT coalesce(sum(amount),0)::text FROM moves WHERE type='cash_out') AS "cashOut" FROM shifts`;

export class PostgresReporting
  extends PostgresInventory
  implements ReportingQueries
{
  async reportOptions(): Promise<ReportOptions> {
    return this.transaction(
      "reports.read",
      async (c) => {
        const result: ReportOptions = {
          locations: [],
          products: [],
          customers: [],
          suppliers: [],
        };
        for (const [key, table] of [
          ["locations", "inventory_locations"],
          ["products", "products"],
          ["customers", "customers"],
          ["suppliers", "suppliers"],
        ] as const)
          result[key] = (
            await c.query<{ id: string; name: string }>(
              `SELECT id,name FROM retail.${table} WHERE tenant_id=$1 ORDER BY name,id LIMIT 100`,
              [this.tenant],
            )
          ).rows;
        return result;
      },
      true,
    );
  }
  async operationalReport(input: ReportFilters): Promise<OperationalReport> {
    const filters = reportFilters(input),
      today = mexicoDate();
    return this.transaction(
      "reports.read",
      async (client) => {
        await client.query("SET LOCAL statement_timeout='5s'");
        // Reject missing/foreign references rather than silently filtering them.
        for (const [table, id] of [
          ["inventory_locations", filters.locationId],
          ["products", filters.productId],
          ["customers", filters.customerId],
          ["suppliers", filters.supplierId],
        ] as const) {
          if (
            id !== undefined &&
            !(
              await client.query(
                `SELECT 1 FROM retail.${table} WHERE tenant_id=$1 AND id=$2`,
                [this.tenant, id],
              )
            ).rowCount
          )
            throw new PermissionDeniedError();
        }
        const values = [
          this.tenant,
          filters.from,
          filters.to,
          filters.locationId ?? null,
          filters.productId ?? null,
          filters.customerId ?? null,
          filters.paymentMethod ?? null,
          today,
          filters.lowStockMilliUnits,
          filters.supplierId ?? null,
        ];
        // Each query has its own placeholder subset; trim trailing values only.
        const query = (sql: string) =>
          sql.replace(
            "WITH ",
            "WITH input AS (SELECT $1::uuid,$2::date,$3::date,$4::uuid,$5::uuid,$6::uuid,$7::text,$8::date,$9::numeric,$10::uuid), ",
          );
        const sales = (
          await client.query<SalesMetrics & { key: string }>(
            query(salesSql),
            values,
          )
        ).rows;
        const products = (
          await client.query<OperationalReport["products"][number]>(
            query(productsSql),
            values,
          )
        ).rows;
        const inventory = (
          await client.query<OperationalReport["inventory"]>(
            query(inventorySql),
            values,
          )
        ).rows[0];
        const purchases = (
          await client.query<OperationalReport["purchases"]>(
            query(purchasesSql),
            values,
          )
        ).rows[0];
        const cash = (
          await client.query<OperationalReport["cash"]>(query(cashSql), values)
        ).rows[0];
        const summary = sales.find((r) => r.key === "period"),
          daily = sales.find((r) => r.key === "today");
        if (!summary || !daily || !inventory || !purchases || !cash)
          throw new Error("Missing reporting projection");
        const metrics = (r: SalesMetrics): SalesMetrics => ({
          gross: r.gross,
          count: r.count,
          average: r.average,
          cash: r.cash,
          card: r.card,
          refunds: r.refunds,
          net: r.net,
          customers: r.customers,
          associated: r.associated,
          general: r.general,
        });
        return {
          filters,
          timezone: "America/Mexico_City",
          today,
          todaySales: metrics(daily),
          sales: metrics(summary),
          days: sales
            .filter((r) => r.key !== "period" && r.key !== "today")
            .map((r) => ({ date: r.key, ...metrics(r) })),
          products,
          inventory,
          purchases,
          cash,
        };
      },
      true,
    );
  }
}

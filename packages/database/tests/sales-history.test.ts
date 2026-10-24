import { expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PermissionDeniedError } from "@smartretail/application";
import { PostgresSales } from "../src/sales";
const tenant = "550e8400-e29b-41d4-a716-446655440001",
  user = "550e8400-e29b-41d4-a716-446655440002",
  location = "550e8400-e29b-41d4-a716-446655440003",
  product = "550e8400-e29b-41d4-a716-446655440004";
const id = (n: number) =>
  `550e8400-e29b-41d4-a716-${n.toString().padStart(12, "0")}`;
const header = (n: number, at = "2026-10-23T12:00:00.123456Z") => ({
  id: id(n),
  tenant_id: tenant,
  location_id: location,
  total_minor_units: "100",
  created_by: user,
  created_at: new Date(at),
  cursor_at: at,
  customer_id: null,
  customer_name: null,
  shift_id: null,
  command_payload: "{}",
  pricing_version: 0,
  discount_details: null,
});
function fixture(
  initial = Array.from({ length: 53 }, (_, n) => header(100 - n)),
  allowed = true,
) {
  let rows = initial;
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("FROM pg_roles")) return { rows: [{ safe: true }] };
    if (sql.includes("has_permission($1)")) return { rows: [{ allowed }] };
    if (sql.startsWith("SELECT s.*,to_char")) {
      let page = rows;
      if (sql.includes("(s.created_at,s.id)<")) {
        const at = values[1] as string,
          beforeId = values[2] as string;
        page = page.filter(
          (r) => r.cursor_at < at || (r.cursor_at === at && r.id < beforeId),
        );
      }
      return { rows: page.slice(0, 51) };
    }
    if (sql.startsWith("SELECT * FROM retail.sale_lines"))
      return {
        rows: (values[1] as string[]).map((sale_id) => ({
          sale_id,
          product_id: product,
          sku: "CAFE",
          product_name: "Café",
          unit: "piece",
          quantity_milli_units: "1000",
          unit_price_minor_units: "100",
          line_total_minor_units: "100",
          discount_minor_units: "0",
          tax_profile_id: null,
          tax_profile_name: null,
          tax_rate: null,
          tax_base_minor_units: null,
          tax_amount_minor_units: "0",
        })),
      };
    if (sql.startsWith("SELECT * FROM retail.sale_payments"))
      return {
        rows: (values[1] as string[]).map((sale_id) => ({
          sale_id,
          method: "cash",
          amount_minor_units: "100",
        })),
      };
    if (sql.startsWith("SELECT DISTINCT sale_id"))
      return { rows: [{ sale_id: (values[1] as string[])[0] }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release };
  const connect = vi.fn(async () => client);
  const repo = new PostgresSales({ connect } as unknown as Pool, {
    userId: user,
    tenantId: tenant,
  });
  return {
    repo,
    query,
    release,
    prepend: () => {
      rows = [header(999, "2026-10-23T13:00:00.000001Z"), ...rows];
    },
  };
}
it("loads only 50 sales plus lookahead with four batched data queries", async () => {
  const f = fixture(),
    page = await f.repo.listSalesPage();
  expect(page.sales).toHaveLength(50);
  expect(page.nextCursor).toBe(`2026-10-23T12:00:00.123456Z~${id(51)}`);
  const data = f.query.mock.calls.filter(
    ([sql]) =>
      sql.includes("FROM retail.sales s") ||
      sql.includes("FROM retail.sale_lines") ||
      sql.includes("FROM retail.sale_payments") ||
      sql.includes("FROM retail.sale_returns"),
  );
  expect(data).toHaveLength(4);
  expect(data[0]![0]).toContain(
    "ORDER BY s.created_at DESC,s.id DESC LIMIT 51",
  );
  expect(data[0]![0]).not.toContain("OFFSET");
  expect(data[0]![0]).toContain('HH24:MI:SS.US"Z"');
  for (const [, values] of data) {
    expect(values?.[0]).toBe(tenant);
  }
  expect(data[1]![1]?.[1]).toHaveLength(50);
  expect(f.query).toHaveBeenCalledWith(
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  expect(f.release).toHaveBeenCalled();
});
it("keeps timestamp precision and ID tie-break across pages, including concurrent inserts", async () => {
  const f = fixture(),
    first = await f.repo.listSalesPage();
  f.prepend();
  const second = await f.repo.listSalesPage({ cursor: first.nextCursor! });
  expect(second.sales).toHaveLength(3);
  expect(second.nextCursor).toBeNull();
  const ids = [...first.sales, ...second.sales].map((s) => s.sale.id);
  expect(new Set(ids).size).toBe(53);
  const call = f.query.mock.calls.filter(([sql]) =>
    sql.startsWith("SELECT s.*,to_char"),
  )[1]!;
  expect(call[0]).toContain("(s.created_at,s.id)<($2::timestamptz,$3::uuid)");
  expect(call[1]?.[1]).toBe("2026-10-23T12:00:00.123456Z");
});
it("binds literal search text, dates, location and payment while scoping every related query", async () => {
  const f = fixture();
  await f.repo.listSalesPage({
    q: "a%'_!",
    from: "2026-10-01",
    to: "2026-10-23",
    locationId: location,
    payment: "card",
  });
  const [sql, values] = f.query.mock.calls.find(([sql]) =>
    sql.startsWith("SELECT s.*,to_char"),
  )!;
  expect(sql).not.toContain("a%'");
  expect(values).toEqual([
    tenant,
    "2026-10-01",
    "2026-10-23",
    location,
    "card",
    "%a!%'!_!!%",
  ]);
  expect(sql).toContain("s.tenant_id=$1");
  expect(sql).toContain("p.tenant_id=s.tenant_id");
  expect(sql).toContain("l.tenant_id=s.tenant_id");
  expect(sql).toContain("AT TIME ZONE 'America/Mexico_City'");
  expect(sql).toContain("::date+1");
});
it("returns an empty page without loading child snapshots", async () => {
  const f = fixture([]);
  expect(await f.repo.listSalesPage()).toEqual({
    sales: [],
    returnedSaleIds: [],
    nextCursor: null,
  });
  expect(f.query.mock.calls.some(([sql]) => sql.includes("sale_id=ANY"))).toBe(
    false,
  );
});
it("denies missing permission before history data queries and rolls back", async () => {
  const f = fixture([], false);
  await expect(f.repo.listSalesPage()).rejects.toBeInstanceOf(
    PermissionDeniedError,
  );
  expect(
    f.query.mock.calls.some(([sql]) => sql.startsWith("SELECT s.*,to_char")),
  ).toBe(false);
  expect(f.query).toHaveBeenCalledWith("ROLLBACK");
  expect(f.release).toHaveBeenCalled();
});

it("does not truncate distinct microseconds within a millisecond", async () => {
  const rows = Array.from({ length: 50 }, (_, n) =>
    header(600 - n, "2026-10-23T12:00:00.123999Z"),
  );
  rows.push(header(999, "2026-10-23T12:00:00.123998Z"));
  const f = fixture(rows),
    first = await f.repo.listSalesPage();
  expect(first.nextCursor).toBe(`2026-10-23T12:00:00.123999Z~${id(551)}`);
  const second = await f.repo.listSalesPage({ cursor: first.nextCursor! });
  expect(second.sales.map((s) => s.sale.id)).toEqual([id(999)]);
  expect(second.nextCursor).toBeNull();
});

import { expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PermissionDeniedError } from "@smartretail/application";
import { PostgresCash } from "../src/cash";
const tenant = "550e8400-e29b-41d4-a716-446655440001",
  user = "550e8400-e29b-41d4-a716-446655440020",
  location = "550e8400-e29b-41d4-a716-446655440011",
  id = "550e8400-e29b-41d4-a716-446655440030";
function fixture(permission = true, access = true) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM pg_roles")) return { rows: [{ safe: true }] };
    if (sql.includes("has_permission($1)"))
      return { rows: [{ allowed: permission }] };
    if (sql.includes("has_location_access"))
      return { rows: [{ allowed: access }] };
    if (sql.startsWith("SELECT id,status,opened_at"))
      return {
        rows: [
          {
            id,
            status: "closed",
            opened_at: new Date("2026-10-24T12:00:00Z"),
            opened_by_name: "Cajero de prueba",
            closed_at: new Date("2026-10-24T13:00:00Z"),
            opening_cash: "100",
            counted_cash: "50",
            difference: "-50",
          },
        ],
      };
    if (sql.startsWith("SELECT m.id,m.shift_id"))
      return {
        rows: [
          {
            id,
            shift_id: id,
            type: "cash_out",
            amount: "50",
            reason: "Retiro",
            created_by: user,
            created_at: new Date("2026-10-24T12:30:00Z"),
          },
        ],
      };
    return { rows: [] };
  });
  const release = vi.fn(),
    client = { query, release };
  const repo = new PostgresCash(
    { connect: async () => client } as unknown as Pool,
    { userId: user, tenantId: tenant },
  );
  return { repo, query, release };
}
it("reads a bounded history scoped by business and authorized location without financial writes", async () => {
  const f = fixture(),
    result = await f.repo.history(location);
  expect(result.shifts[0]?.difference?.minorUnits).toBe(-50n);
  expect(result.movements[0]?.amount.minorUnits).toBe(50n);
  const calls = f.query.mock.calls as unknown as [string, unknown[]?][];
  expect(
    calls.some(
      ([sql]) => sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    ),
  ).toBe(true);
  const data = calls.filter(
    ([sql]) =>
      sql.startsWith("SELECT id,status,") ||
      sql.startsWith("SELECT m.id,m.shift_id"),
  );
  expect(data).toHaveLength(2);
  expect(data[0]![0]).toContain("tenant_id=$1 AND location_id=$2");
  expect(data[0]![0]).toContain("LIMIT 10");
  expect(data[1]![0]).toContain("s.tenant_id=m.tenant_id");
  expect(data[1]![0]).toContain("m.tenant_id=$1 AND s.location_id=$2");
  expect(data[1]![0]).toContain("LIMIT 20");
  for (const [, values] of data) expect(values).toEqual([tenant, location]);
  expect(
    calls.every(
      ([sql]) =>
        !/INSERT|UPDATE|DELETE|open_cash|close_cash|lock_membership/.test(sql),
    ),
  ).toBe(true);
  expect(f.release).toHaveBeenCalled();
});
it.each([
  [false, true],
  [true, false],
])(
  "denies missing permission or foreign location before any history rows",
  async (permission, access) => {
    const f = fixture(permission, access);
    await expect(f.repo.history(location)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    expect(
      f.query.mock.calls.some(
        ([sql]) =>
          sql.startsWith("SELECT id,status,") ||
          sql.startsWith("SELECT m.id,m.shift_id"),
      ),
    ).toBe(false);
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
  },
);

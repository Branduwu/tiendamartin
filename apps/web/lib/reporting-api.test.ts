import { beforeEach, expect, it, vi } from "vitest";
import {
  PermissionDeniedError,
  type OperationalReport,
} from "@smartretail/application";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  query: vi.fn(),
  options: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ verifiedUserId: m.user }));
vi.mock("./database", () => ({ reportingForUser: m.repo }));
import { handleReports } from "./reporting-api";
import { reportingCsv } from "./reporting-csv";
const user = "550e8400-e29b-41d4-a716-446655440020",
  tenant = "550e8400-e29b-41d4-a716-446655440001";
const request = (q = "", headers = {}) =>
  new Request("https://example.test/api/v1/reports" + q, {
    headers: { "x-tenant-id": tenant, ...headers },
  });
const metrics = {
  gross: "9007199254740993",
  count: "1",
  average: "9007199254740993",
  cash: "0",
  card: "9007199254740993",
  refunds: "1",
  net: "9007199254740992",
  baseGross: "9007199254740993",
  discounts: "0",
  taxCollected: "0",
  taxRefunded: "0",
  netCommercial: "9007199254740992",
  customers: "0",
  associated: "0",
  general: "1",
};
const report: OperationalReport = {
  filters: { from: "2026-10-01", to: "2026-10-03" },
  timezone: "America/Mexico_City",
  today: "2026-10-03",
  todaySales: metrics,
  sales: metrics,
  days: [{ date: "2026-10-03", ...metrics }],
  products: [
    {
      id: tenant,
      name: ' =HYPERLINK("evil")',
      unit: "piece",
      quantity: "1000",
      revenue: "1",
      stock: "0",
    },
  ],
  inventory: { low: "0", empty: "0", alerts: [] },
  purchases: {
    created: "0",
    pending: "0",
    partial: "0",
    received: "0",
    orderedAmount: "0",
    receivedAmount: "0",
  },
  cash: {
    open: "0",
    closed: "0",
    expected: "0",
    shortage: "0",
    surplus: "0",
    cashIn: "0",
    cashOut: "0",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue(user);
  m.repo.mockReturnValue({
    operationalReport: m.query,
    reportOptions: m.options,
  });
  m.query.mockResolvedValue(report);
  m.options.mockResolvedValue({ locations: [] });
});
it("requires session before any database composition", async () => {
  m.user.mockResolvedValue(null);
  expect((await handleReports(request())).status).toBe(401);
  expect(m.repo).not.toHaveBeenCalled();
});
it("derives actor from Auth rather than forged headers and keeps bigint values exact", async () => {
  const r = await handleReports(
    request("?period=7d", { "x-user-id": "forged", "x-role": "owner" }),
  );
  expect(r.status).toBe(200);
  expect(m.repo).toHaveBeenCalledWith(user, tenant);
  expect((await r.json()).sales.gross).toBe("9007199254740993");
  expect(r.headers.get("cache-control")).toBe("private, no-store");
});
it("rejects duplicate unknown malformed and oversized period queries", async () => {
  for (const q of [
    "?period=today&period=7d",
    "?tenantId=" + tenant,
    "?period=custom&from=2026-02-29&to=2026-03-01",
    "?period=custom&from=2024-01-01&to=2025-01-01",
    "?productId=bad",
    "?lowStockMilliUnits=01",
  ])
    expect((await handleReports(request(q))).status).toBe(400);
  expect(m.query).not.toHaveBeenCalled();
});
it("permissions fail closed for json selectors and CSV", async () => {
  m.query.mockRejectedValue(new PermissionDeniedError());
  m.options.mockRejectedValue(new PermissionDeniedError());
  for (const output of ["json", "options", "sales", "products"] as const)
    expect((await handleReports(request(), output)).status).toBe(403);
});
it("sanitizes SQL errors without logging PII or query values", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  m.query.mockRejectedValue(
    new Error("secret customer@example.invalid password SQL"),
  );
  const r = await handleReports(request());
  expect(r.status).toBe(500);
  expect(await r.text()).not.toMatch(/password|SQL|example.invalid/);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(
    /password|SQL|example.invalid/,
  );
  log.mockRestore();
});
it("CSV respects the same filters and neutralizes spreadsheet formulas", async () => {
  const r = await handleReports(
    request("?period=custom&from=2026-10-01&to=2026-10-03"),
    "sales",
  );
  expect(r.status).toBe(200);
  expect(await r.text()).toContain("9007199254740993");
  expect(m.query).toHaveBeenCalledWith(
    expect.objectContaining({ from: "2026-10-01", to: "2026-10-03" }),
  );
  expect(reportingCsv(report, "products")).toContain(
    '"\' =HYPERLINK(""evil"")"',
  );
  expect(r.headers.get("content-disposition")).toContain(
    "2026-10-01-2026-10-03.csv",
  );
});

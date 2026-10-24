// Synthetic transaction staging only. No PostgreSQL durability, locks, RLS or payment gateway is certified.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSaleProduct,
  createSaleDraft,
  createProduct,
  createInventoryLocation,
  inventoryLocationId,
  inventoryLocationCode,
  inventoryLocationName,
  productId,
  productName,
  sku,
  quantity,
  money,
  stockBalance,
  expectedCash,
  type StockBalance,
  type InventoryIssue,
  type CompletedSale,
} from "@smartretail/domain";
import {
  defaultBusinessProfile,
  PermissionDeniedError,
  CashStateConflictError,
  SaleNotFoundError,
  type SaleUnitOfWork,
  type SaleTransaction,
  type StoredSale,
  type SaleCheckoutInput,
} from "@smartretail/application";
import { completedSaleDto } from "./sale-mapping";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  business: vi.fn(),
  locations: vi.fn(),
  returns: vi.fn(),
  tenants: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ verifiedUserId: mocks.user }));
vi.mock("./database", () => ({
  salesForUser: mocks.repo,
  businessForUser: mocks.business,
  inventoryForUser: mocks.locations,
  returnsForUser: mocks.returns,
  tenantsForUser: mocks.tenants,
}));
vi.mock("../app/sales/[id]/return-panel", () => ({ default: () => null }));
vi.mock("../app/sales/[id]/print-button", () => ({ default: () => null }));
import { POST } from "../app/api/v1/sales/route";
import { GET } from "../app/api/v1/sales/[id]/route";
import TicketPage from "../app/sales/[id]/page";
const id = (n: number) =>
  `550e8400-e29b-41d4-a716-${String(n).padStart(12, "0")}`;
const tenant = id(1),
  user = id(20),
  locationId = id(11),
  shiftId = id(30);
const product = createProduct({
  id: productId(id(41)),
  name: productName("Café de prueba"),
  sku: sku("CAFE-01"),
  unit: "piece",
  status: "active",
  purchaseCost: money(1000n),
  salePrice: money(2550n),
});
const location = createInventoryLocation({
  id: inventoryLocationId(locationId),
  code: inventoryLocationCode("CENTRO"),
  name: inventoryLocationName("Sucursal ficticia"),
  status: "active",
});
/** Matches the existing FakeInventory staging pattern, not a replacement persistence adapter. */
class SyntheticCheckout implements SaleUnitOfWork {
  balances = new Map<string, StockBalance>([
    [
      product.id,
      stockBalance({
        productId: product.id,
        locationId: location.id,
        quantity: quantity("piece", 10000n),
      }),
    ],
  ]);
  issues = new Map<string, InventoryIssue>();
  sales = new Map<string, { payload: string; recorded: StoredSale }>();
  allowed = true;
  open = true;
  failAt = "";
  tail: Promise<unknown> = Promise.resolve();
  async readSale(id: string) {
    const found = this.sales.get(id);
    if (!this.allowed) throw new PermissionDeniedError();
    if (!found) throw new SaleNotFoundError();
    return found.recorded;
  }
  async runSale<T>(
    saleId: string,
    work: (tx: SaleTransaction) => Promise<T>,
  ): Promise<T> {
    const run = async () => {
      if (!this.allowed) throw new PermissionDeniedError();
      const balances = new Map(this.balances),
        issues = new Map(this.issues),
        sales = new Map(this.sales);
      const tx: SaleTransaction = {
        findRecorded: async () => sales.get(saleId),
        lockOpenShift: async (loc, shift) => {
          if (!this.open || loc !== locationId || shift !== shiftId)
            throw new CashStateConflictError();
        },
        readProduct: async (pid) => (pid === product.id ? product : undefined),
        readLocation: async (loc) =>
          loc === location.id ? location : undefined,
        lockBalances: async () => {},
        readBalance: async (pid) => {
          const b = balances.get(pid);
          if (!b) throw Error("Synthetic missing balance");
          return b;
        },
        appendIssue: async (issue, balance) => {
          issues.set(issue.id, issue);
          balances.set(issue.productId, balance);
          if (this.failAt === "issue")
            throw Error("Synthetic persistence failure");
        },
        persistSale: async (
          sale: CompletedSale,
          input: SaleCheckoutInput,
          payload: string,
        ) => {
          const recorded: StoredSale = {
            sale,
            payments: input.payments,
            tenantId: tenant,
            locationId,
            shiftId,
            createdBy: user,
            createdAt: "2026-10-24T18:00:00Z",
          };
          sales.set(saleId, { payload, recorded });
          if (this.failAt === "persist")
            throw Error("Synthetic persistence failure");
          return recorded;
        },
      };
      const result = await work(tx);
      this.balances = balances;
      this.issues = issues;
      this.sales = sales;
      return result;
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => {});
    return result;
  }
  cash() {
    const payments = [...this.sales.values()].flatMap(
      (s) => s.recorded.payments,
    );
    return expectedCash(
      money(10000n),
      money(
        payments
          .filter((p) => p.method === "cash")
          .reduce((n, p) => n + p.amount.minorUnits, 0n),
      ),
      money(0n),
      money(0n),
    ).minorUnits;
  }
}
function command(n = 100, method: "cash" | "card" | "mixed" = "cash") {
  const draft = addSaleProduct(
    createSaleDraft(id(n)),
    product,
    quantity("piece", 2000n),
  );
  return {
    draft,
    locationId,
    shiftId,
    payments:
      method === "mixed"
        ? [
            { method: "cash" as const, amount: money(2000n) },
            { method: "card" as const, amount: money(3100n) },
          ]
        : [{ method, amount: money(5100n) }],
    movements: [{ productId: product.id, movementId: id(n + 1000) }],
  };
}
function body(input: ReturnType<typeof command>) {
  return {
    ...input,
    draft: {
      ...completedSaleDto({ ...input.draft, status: "completed" }),
      status: "draft",
    },
    payments: input.payments.map((p) => ({
      ...p,
      amount: { currency: "MXN", minorUnits: p.amount.minorUnits.toString() },
    })),
  };
}
function req(input: ReturnType<typeof command>, t = tenant) {
  return new Request("https://example.test/api/v1/sales", {
    method: "POST",
    headers: {
      origin: "https://example.test",
      "content-type": "application/json",
      "x-tenant-id": t,
    },
    body: JSON.stringify(body(input)),
  });
}
let db: SyntheticCheckout;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("React", React);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = new SyntheticCheckout();
  mocks.user.mockResolvedValue(user);
  mocks.repo.mockImplementation((_user, t) => {
    if (t !== tenant) throw new PermissionDeniedError();
    return db;
  });
  mocks.business.mockReturnValue({
    read: async () => ({
      profile: { ...defaultBusinessProfile, businessName: "Tienda ficticia" },
      branches: [],
    }),
  });
  mocks.locations.mockReturnValue({ listLocations: async () => [location] });
  mocks.returns.mockReturnValue({
    listReturns: async () => [],
    settlement: async () => ({}),
  });
  mocks.tenants.mockResolvedValue([
    {
      tenantId: tenant,
      permissions: [
        "sales.read",
        "sales.create",
        "locations.read",
        "inventory.read",
      ],
    },
  ]);
});
describe("commercial journey with real application/API code and synthetic persistence", () => {
  for (const method of ["cash", "card", "mixed"] as const)
    it(`sale → stock → read → ticket → cash: ${method}`, async () => {
      const input = command(100, method);
      const response = await POST(req(input));
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.recorded.sale.total.minorUnits).toBe("5100");
      expect(db.sales.size).toBe(1);
      expect(db.issues.size).toBe(1);
      expect(db.balances.get(product.id)?.quantity.milliUnits).toBe(8000n);
      expect(db.cash()).toBe(
        method === "cash" ? 15100n : method === "card" ? 10000n : 12000n,
      );
      const read = await GET(
        new Request("https://example.test/api/v1/sales/" + input.draft.id, {
          headers: { "x-tenant-id": tenant },
        }),
        { params: Promise.resolve({ id: input.draft.id }) },
      );
      expect(read.status).toBe(200);
      expect((await read.json()).recorded).toEqual(data.recorded);
      const html = renderToStaticMarkup(
        await TicketPage({
          params: Promise.resolve({ id: input.draft.id }),
          searchParams: Promise.resolve({ tenantId: tenant }),
        }),
      );
      expect(html).toContain(input.draft.id);
      expect(html).toContain("Café de prueba");
      expect(html).toContain("51.00");
      expect(html).toContain(shiftId);
      expect(html).toContain(method === "card" ? "Tarjeta" : "Efectivo");
    });
  it("replays a lost response without a second stock/cash effect", async () => {
    const input = command();
    await POST(req(input));
    const replay = await POST(req(input));
    expect(replay.status).toBe(200);
    expect((await replay.json()).replayed).toBe(true);
    expect(db.sales.size).toBe(1);
    expect(db.issues.size).toBe(1);
    expect(db.cash()).toBe(15100n);
    expect(db.balances.get(product.id)?.quantity.milliUnits).toBe(8000n);
  });
  it("serialised synthetic concurrent requests share one result", async () => {
    const input = command();
    const results = await Promise.all([POST(req(input)), POST(req(input))]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(db.sales.size).toBe(1);
    expect(db.issues.size).toBe(1);
  });
  for (const failAt of ["issue", "persist"])
    it(`staged failure at ${failAt} leaves no sale/stock/cash effect`, async () => {
      db.failAt = failAt;
      const response = await POST(req(command()));
      expect(response.status).toBe(500);
      expect(db.sales.size).toBe(0);
      expect(db.issues.size).toBe(0);
      expect(db.cash()).toBe(10000n);
      expect(db.balances.get(product.id)?.quantity.milliUnits).toBe(10000n);
      db.failAt = "";
      expect((await POST(req(command()))).status).toBe(201);
      expect(db.sales.size).toBe(1);
    });
  it("rejects changed payments under the same sale id", async () => {
    await POST(req(command()));
    expect((await POST(req(command(100, "card")))).status).toBe(409);
    expect(db.cash()).toBe(15100n);
    expect(db.issues.size).toBe(1);
  });
  it("rejects closed shift without stock changes", async () => {
    db.open = false;
    expect((await POST(req(command()))).status).toBe(409);
    expect(db.issues.size).toBe(0);
    expect(db.sales.size).toBe(0);
  });
  it("rejects insufficient stock without writes", async () => {
    db.balances.set(
      product.id,
      stockBalance({
        productId: product.id,
        locationId: location.id,
        quantity: quantity("piece", 1000n),
      }),
    );
    expect((await POST(req(command()))).status).toBe(409);
    expect(db.issues.size).toBe(0);
    expect(db.sales.size).toBe(0);
  });
  it("rejects a payment total inconsistent with the quote", async () => {
    const input = command();
    input.payments = [{ method: "cash", amount: money(1n) }];
    expect((await POST(req(input))).status).toBe(409);
    expect(db.issues.size).toBe(0);
  });
  it("rejects revoked permission before the synthetic unit of work", async () => {
    db.allowed = false;
    expect((await POST(req(command()))).status).toBe(403);
    expect(db.sales.size).toBe(0);
  });
  it("rejects another company", async () => {
    expect((await POST(req(command(), id(2)))).status).toBe(403);
    expect(db.sales.size).toBe(0);
  });
  it("rejects missing identity", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(req(command()))).status).toBe(401);
    expect(db.sales.size).toBe(0);
  });
  it("rejects cross-origin request", async () => {
    const request = req(command());
    request.headers.set("origin", "https://other.test");
    expect((await POST(request)).status).toBe(403);
    expect(db.sales.size).toBe(0);
  });
});

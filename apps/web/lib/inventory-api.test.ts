import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  stockBalance,
  productId,
  inventoryLocationId,
  quantity,
  inventoryLocationCode,
  inventoryLocationName,
  type InventoryLocation,
} from "@smartretail/domain";
import {
  PermissionDeniedError,
  StockBalanceNotFoundError,
  InventoryIdempotencyConflictError,
} from "@smartretail/application";
import { FakeInventory } from "../../../packages/application/tests/fake-inventory";
import { decimalToMilliUnits, milliUnitsToDecimal } from "./quantity-input";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ identity: vi.fn(), factory: vi.fn() }));
vi.mock("./auth", () => ({ verifiedUserId: mocks.identity }));
vi.mock("./database", () => ({ inventoryForUser: mocks.factory }));
import { handleInventory, type InventoryOperation } from "./inventory-api";
import {
  GET as locationsGET,
  POST as locationsPOST,
} from "../app/api/v1/locations/route";
import { GET as stockGET } from "../app/api/v1/inventory/route";
import { POST as receivePOST } from "../app/api/v1/inventory/receive/route";
import { POST as issuePOST } from "../app/api/v1/inventory/issue/route";
import { POST as adjustmentPOST } from "../app/api/v1/inventory/adjustment/route";
import { POST as countPOST } from "../app/api/v1/inventory/count/route";
import { POST as transferPOST } from "../app/api/v1/inventory/transfer/route";
const tenant = "550e8400-e29b-41d4-a716-446655440001";
const user = "550e8400-e29b-41d4-a716-446655440020";
const product = productId("550e8400-e29b-41d4-a716-446655440010");
const source = inventoryLocationId("550e8400-e29b-41d4-a716-446655440011");
const destination = inventoryLocationId("550e8400-e29b-41d4-a716-446655440012");
const key = { productId: product, locationId: source };
const initial = (locationId = source, amount = 10000n) =>
  stockBalance({ ...key, locationId, quantity: quantity("piece", amount) });
class Repository extends FakeInventory {
  async listLocations() {
    return [
      {
        id: source,
        code: inventoryLocationCode("MAIN"),
        name: inventoryLocationName("Principal"),
        status: "active" as const,
      },
    ];
  }
  async createLocation(value: InventoryLocation) {
    return value;
  }
  async listStock() {
    return [
      {
        balance: this.balance(key)!,
        productName: "Café",
        sku: "CAFE",
        locationName: "Principal",
        locationCode: "MAIN",
      },
    ];
  }
}
let repo: Repository;
const request = (
  body?: unknown,
  headers: Record<string, string> = {},
  query = "",
) =>
  new Request(`http://localhost:3000/api/v1/inventory${query}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-tenant-id": tenant,
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const receipt = (amount = "1250") => ({
  ...key,
  id: randomUUID(),
  type: "receipt",
  quantity: { unit: "piece", milliUnits: amount },
});
const issue = (amount = "1250") => ({ ...receipt(amount), type: "issue" });
const adjustment = (amount = "-1000") => ({
  ...key,
  id: randomUUID(),
  type: "adjustment",
  delta: { unit: "piece", milliUnits: amount },
  reason: "Merma",
});
const count = (amount: string) => ({
  ...key,
  id: randomUUID(),
  counted: { unit: "piece", milliUnits: amount },
  reason: "Conteo físico",
});
const transfer = () => ({
  id: randomUUID(),
  issueMovementId: randomUUID(),
  receiptMovementId: randomUUID(),
  productId: product,
  sourceLocationId: source,
  destinationLocationId: destination,
  quantity: { unit: "piece", milliUnits: "2000" },
});
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.identity.mockResolvedValue(user);
  repo = new Repository([initial(), initial(destination, 0n)]);
  mocks.factory.mockReturnValue(repo);
});
describe("inventory web boundary", () => {
  it("lists locations and stock with exact serializable quantities", async () => {
    expect((await locationsGET(request())).status).toBe(200);
    const response = await stockGET(request());
    expect(await response.json()).toMatchObject({
      stock: [
        { productName: "Café", sku: "CAFE", quantity: { milliUnits: "10000" } },
      ],
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.factory).toHaveBeenCalledWith(user, tenant);
  });
  it("creates a strict location with caller's stable operation ID", async () => {
    const input = {
      id: randomUUID(),
      code: "NEW",
      name: "Nueva",
      status: "active",
    };
    const response = await locationsPOST(request(input));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ location: input });
  });
  it("returns 401 without invoking persistence for an unauthenticated caller", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await receivePOST(request(receipt()))).status).toBe(401);
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("requires a valid selected tenant", async () => {
    expect(
      (await stockGET(request(undefined, { "x-tenant-id": "other" }))).status,
    ).toBe(400);
  });
  it.each([
    "locations",
    "stock",
    "receive",
    "issue",
    "adjustment",
    "count",
    "transfer",
  ] as const)(
    "maps transaction permission denial for %s",
    async (operation) => {
      vi.spyOn(repo, "run").mockRejectedValue(new PermissionDeniedError());
      vi.spyOn(repo, "listLocations").mockRejectedValue(
        new PermissionDeniedError(),
      );
      vi.spyOn(repo, "listStock").mockRejectedValue(
        new PermissionDeniedError(),
      );
      const body =
        operation === "receive"
          ? receipt()
          : operation === "issue"
            ? issue()
            : operation === "adjustment"
              ? adjustment()
              : operation === "count"
                ? count("10000")
                : operation === "transfer"
                  ? transfer()
                  : undefined;
      expect((await handleInventory(request(body), operation)).status).toBe(
        403,
      );
    },
  );
  it("receives and issues exact quantities through application", async () => {
    expect((await receivePOST(request(receipt()))).status).toBe(200);
    expect(repo.balance(key)?.quantity.milliUnits).toBe(11250n);
    expect((await issuePOST(request(issue("250")))).status).toBe(200);
    expect(repo.balance(key)?.quantity.milliUnits).toBe(11000n);
  });
  it("insufficient stock returns 409 without writes", async () => {
    expect((await issuePOST(request(issue("10001")))).status).toBe(409);
    expect(repo.balance(key)?.quantity.milliUnits).toBe(10000n);
    expect(repo.movements.size).toBe(0);
  });
  it("supports a signed adjustment and rejects one that overspends", async () => {
    expect((await adjustmentPOST(request(adjustment()))).status).toBe(200);
    expect((await adjustmentPOST(request(adjustment("-9001")))).status).toBe(
      409,
    );
    expect(repo.balance(key)?.quantity.milliUnits).toBe(9000n);
  });
  it.each(["12000", "8000", "10000"])(
    "counts %s rather than accepting a client delta",
    async (amount) => {
      const response = await countPOST(request(count(amount)));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: amount === "10000" ? "no-change" : "adjusted",
      });
      expect(repo.balance(key)?.quantity.milliUnits).toBe(BigInt(amount));
      expect(repo.movements.size).toBe(amount === "10000" ? 0 : 1);
    },
  );
  it("transfers both sides and rolls back on insufficient stock", async () => {
    expect((await transferPOST(request(transfer()))).status).toBe(200);
    const bad = {
      ...transfer(),
      quantity: { unit: "piece", milliUnits: "8001" },
    };
    expect((await transferPOST(request(bad))).status).toBe(409);
    expect(repo.balance(key)?.quantity.milliUnits).toBe(8000n);
    expect(
      repo.balance({ ...key, locationId: destination })?.quantity.milliUnits,
    ).toBe(2000n);
  });
  it("rejects transfer to the same location", async () => {
    expect(
      (
        await transferPOST(
          request({ ...transfer(), destinationLocationId: source }),
        )
      ).status,
    ).toBe(400);
    expect(repo.events).toEqual([]);
  });
  it("rejects numeric quantity, forged stock and identity fields", async () => {
    for (const body of [
      { ...receipt(), quantity: { unit: "piece", milliUnits: 100 } },
      { ...receipt(), balance: "999" },
      { ...receipt(), userId: user, role: "owner" },
    ])
      expect((await receivePOST(request(body))).status).toBe(400);
    expect(repo.events).toEqual([]);
  });
  it("rejects negative counts, missing reasons and unknown fields", async () => {
    for (const body of [
      count("-1"),
      { ...count("0"), reason: "" },
      { ...count("0"), delta: "2" },
    ])
      expect((await countPOST(request(body))).status).toBe(400);
  });
  it("enforces same origin for every mutation", async () => {
    const operations: [InventoryOperation, unknown][] = [
      [
        "create-location",
        { id: randomUUID(), code: "NEW", name: "Nueva", status: "active" },
      ],
      ["receive", receipt()],
      ["issue", issue()],
      ["adjustment", adjustment()],
      ["count", count("0")],
      ["transfer", transfer()],
    ];
    for (const [operation, body] of operations)
      expect(
        (
          await handleInventory(
            request(body, { origin: "https://attacker.test" }),
            operation,
          )
        ).status,
      ).toBe(403);
    expect(repo.events).toEqual([]);
  });
  it("rejects duplicate and unexpected stock query fields", async () => {
    for (const query of [
      `?locationId=${source}&locationId=${destination}`,
      "?role=owner",
      "?locationId=bad",
    ])
      expect((await stockGET(request(undefined, {}, query))).status).toBe(400);
  });
  it("maps missing/foreign resource to 404", async () => {
    vi.spyOn(repo, "run").mockRejectedValue(new StockBalanceNotFoundError());
    expect((await receivePOST(request(receipt()))).status).toBe(404);
  });
  it("maps durable ID collision to 409", async () => {
    vi.spyOn(repo, "run").mockRejectedValue(
      new InventoryIdempotencyConflictError(),
    );
    expect((await receivePOST(request(receipt()))).status).toBe(409);
  });
  it("sanitizes internal persistence errors", async () => {
    vi.spyOn(repo, "run").mockRejectedValue(new Error("SQL password hidden"));
    const response = await receivePOST(request(receipt()));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/SQL|password|hidden/);
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining("password"),
    );
  });
});
describe("exact decimal quantity input", () => {
  it.each([
    ["1", "1000"],
    ["0.5", "500"],
    ["1.250", "1250"],
  ])("converts %s exactly", (input, expected) =>
    expect(decimalToMilliUnits(input!)).toBe(expected),
  );
  it("supports a signed delta and exact large presentation", () => {
    expect(decimalToMilliUnits("-1.250", true)).toBe("-1250");
    expect(milliUnitsToDecimal("9007199254740993123")).toBe(
      "9007199254740993.123",
    );
    expect(milliUnitsToDecimal("0")).toBe("0.000");
  });
  it("rejects fourth decimals, exponent, whitespace and absurd length", () => {
    for (const value of [
      "1.0001",
      "1e3",
      " 1",
      "1 ",
      "01",
      "",
      "1".repeat(129),
    ])
      expect(() => decimalToMilliUnits(value)).toThrow();
  });
});

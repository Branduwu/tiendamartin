import { beforeEach, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "@smartretail/application";

vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ verifiedUserId: vi.fn() }));
vi.mock("./database", () => ({
  inventoryMinimumForUser: vi.fn(),
  reportingForUser: vi.fn(),
}));
import { createInventoryMinimumHandler } from "./inventory-minimum-api";
import { PATCH } from "../app/api/v1/inventory/minimums/route";
import { GET as alertsRoute } from "../app/api/v1/inventory/alerts/route";
import { GET as replenishmentRoute } from "../app/api/v1/inventory/replenishment/route";
import { verifiedUserId } from "./auth";
import { inventoryMinimumForUser, reportingForUser } from "./database";

const user = "550e8400-e29b-41d4-a716-446655440020";
const tenant = "550e8400-e29b-41d4-a716-446655440001";
const productId = "550e8400-e29b-41d4-a716-446655440002";
const locationId = "550e8400-e29b-41d4-a716-446655440003";
const body = {
  productId,
  locationId,
  minimumStock: { unit: "kg", milliUnits: "9007199254740993" },
};
const m = {
  user: vi.fn(),
  minimum: vi.fn(),
  reporting: vi.fn(),
  set: vi.fn(),
  alerts: vi.fn(),
  replenishment: vi.fn(),
};
const handle = createInventoryMinimumHandler({
  verifiedUserId: m.user,
  minimumForUser: m.minimum,
  reportingForUser: m.reporting,
});
const request = (
  operation = "alerts",
  query = "",
  value: unknown = body,
  headers = {},
) =>
  new Request(`https://example.test/api/v1/inventory/${operation}${query}`, {
    method: operation === "minimums" ? "PATCH" : "GET",
    headers: {
      "x-tenant-id": tenant,
      origin: "https://example.test",
      "content-type": "application/json",
      ...headers,
    },
    ...(operation === "minimums" ? { body: JSON.stringify(value) } : {}),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue(user);
  m.minimum.mockReturnValue({ setMinimum: m.set });
  m.reporting.mockReturnValue({
    inventoryAlerts: m.alerts,
    replenishment: m.replenishment,
  });
  m.set.mockResolvedValue(undefined);
});

it("requires verified sessions and a valid tenant selector before composing repositories", async () => {
  m.user.mockResolvedValue(null);
  for (const operation of ["minimums", "alerts", "replenishment"] as const)
    expect(
      (
        await handle(
          request(operation, "", body, {
            "x-user-id": user,
            "x-role": "owner",
          }),
          operation,
        )
      ).status,
    ).toBe(401);
  m.user.mockResolvedValue(user);
  expect(
    (
      await handle(
        request("alerts", "", body, { "x-tenant-id": "bad" }),
        "alerts",
      )
    ).status,
  ).toBe(400);
  expect(m.minimum).not.toHaveBeenCalled();
  expect(m.reporting).not.toHaveBeenCalled();
});

it("PATCH wires exact set update and removal to the authenticated repository with correlated audit", async () => {
  const audit = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(verifiedUserId).mockResolvedValue(user);
  vi.mocked(inventoryMinimumForUser).mockReturnValue({
    setMinimum: m.set,
  });
  for (const minimumStock of [
    body.minimumStock,
    { unit: "kg", milliUnits: "0" },
    null,
  ]) {
    const response = await PATCH(
      request(
        "minimums",
        "",
        { ...body, minimumStock },
        { "x-user-id": "forged", "x-role": "owner" },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...body, minimumStock });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(m.set).toHaveBeenLastCalledWith(
      productId,
      locationId,
      minimumStock === null
        ? null
        : { unit: "kg", milliUnits: BigInt(minimumStock.milliUnits) },
    );
  }
  const correlationId = vi.mocked(inventoryMinimumForUser).mock.calls[0]?.[2];
  expect(correlationId).toMatch(/^[a-f0-9-]{36}$/);
  expect(vi.mocked(inventoryMinimumForUser)).toHaveBeenCalledWith(
    user,
    tenant,
    correlationId,
  );
  expect(JSON.parse(audit.mock.calls[0]?.[0] as string)).toEqual(
    expect.objectContaining({
      operation: "inventory.minimum.write",
      userId: user,
      tenantId: tenant,
      correlationId,
    }),
  );
  audit.mockRestore();
});

it("rejects CSRF malformed bodies quantities and strict duplicate or unknown filters before repository access", async () => {
  for (const headers of [
    { origin: "https://evil.test" },
    { origin: "" },
    { "sec-fetch-site": "cross-site" },
  ])
    expect(
      (await handle(request("minimums", "", body, headers), "minimums")).status,
    ).toBe(403);
  for (const value of [
    { ...body, role: "owner" },
    { ...body, minimumStock: { unit: "piece", milliUnits: "1" } },
    { ...body, minimumStock: { unit: "kg", milliUnits: "-1" } },
    { ...body, minimumStock: { unit: "kg", milliUnits: 1000 } },
  ])
    expect(
      (await handle(request("minimums", "", value), "minimums")).status,
    ).toBe(400);
  const malformed = request("minimums");
  expect(
    (
      await handle(
        new Request(malformed.url, {
          method: "PATCH",
          headers: malformed.headers,
          body: "{",
        }),
        "minimums",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handle(
        request("minimums", "", body, { "content-type": "text/plain" }),
        "minimums",
      )
    ).status,
  ).toBe(400);
  expect(
    (await handle(request("minimums", "?productId=" + productId), "minimums"))
      .status,
  ).toBe(400);
  for (const query of [
    "?role=owner",
    "?tenantId=" + tenant,
    "?productId=bad",
    `?locationId=${locationId}&locationId=${locationId}`,
  ])
    for (const operation of ["alerts", "replenishment"] as const)
      expect((await handle(request(operation, query), operation)).status).toBe(
        400,
      );
  for (const query of [
    "",
    `?productId=${productId}`,
    `?locationId=${locationId}`,
  ])
    expect(
      (await handle(request("replenishment", query), "replenishment")).status,
    ).toBe(400);
  expect(m.minimum).not.toHaveBeenCalled();
  expect(m.reporting).not.toHaveBeenCalled();
});

it("GET routes preserve filters exact suggestions and purchase prefill without mutating inventory", async () => {
  const alerts = {
    low: "1",
    empty: "0",
    alerts: [
      {
        id: productId,
        name: "Arroz",
        sku: "RICE",
        locationId,
        locationName: "Central",
        unit: "kg",
        stock: "0",
        minimum: "9007199254740993",
        suggested: "9007199254740993",
        state: "out",
      },
    ],
  };
  const prefill = {
    tenantId: tenant,
    productId,
    locationId,
    quantityOrdered: body.minimumStock,
  };
  m.alerts.mockResolvedValue(alerts);
  m.replenishment.mockResolvedValue(prefill);
  vi.mocked(verifiedUserId).mockResolvedValue(user);
  vi.mocked(reportingForUser).mockImplementation(m.reporting);
  const query = `?productId=${productId}&locationId=${locationId}`;
  expect(await (await alertsRoute(request("alerts", query))).json()).toEqual(
    alerts,
  );
  expect(m.alerts).toHaveBeenCalledWith(locationId, productId);
  expect(
    await (await replenishmentRoute(request("replenishment", query))).json(),
  ).toEqual(prefill);
  expect(m.replenishment).toHaveBeenCalledWith(productId, locationId);
  expect(vi.mocked(reportingForUser)).toHaveBeenCalledWith(user, tenant);
  expect(await (await alertsRoute(request())).json()).toEqual(alerts);
  expect(m.alerts).toHaveBeenLastCalledWith(undefined, undefined);
  expect(m.set).not.toHaveBeenCalled();
});

it("fails closed on repository membership resource and permission denials for all operations", async () => {
  m.set.mockRejectedValue(new PermissionDeniedError());
  m.alerts.mockRejectedValue(new PermissionDeniedError());
  m.replenishment.mockRejectedValue(new PermissionDeniedError());
  for (const operation of ["minimums", "alerts", "replenishment"] as const)
    expect(
      (
        await handle(
          request(
            operation,
            operation === "replenishment"
              ? `?productId=${productId}&locationId=${locationId}`
              : "",
            body,
            { "x-role": "owner" },
          ),
          operation,
        )
      ).status,
    ).toBe(403);
});

it("returns generic validation and unexpected errors without exposing SQL or sensitive log details", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  m.set.mockRejectedValue(new TypeError("Product unit mismatch"));
  expect((await handle(request("minimums"), "minimums")).status).toBe(400);
  for (const operation of ["minimums", "alerts", "replenishment"] as const) {
    m.set.mockRejectedValue(new Error("SELECT secret password"));
    m.alerts.mockRejectedValue(new Error("SELECT secret password"));
    m.replenishment.mockRejectedValue(new Error("SELECT secret password"));
    const response = await handle(
      request(
        operation,
        operation === "replenishment"
          ? `?productId=${productId}&locationId=${locationId}`
          : "",
      ),
      operation,
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/SELECT|secret|password/);
  }
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/SELECT|secret|password/);
  log.mockRestore();
});

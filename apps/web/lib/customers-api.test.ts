import { beforeEach, it, expect, vi } from "vitest";
import {
  PermissionDeniedError,
  CustomerNotFoundError,
} from "@smartretail/application";
import { money } from "@smartretail/domain";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
}));
vi.mock("./auth", () => ({ verifiedUserId: m.user }));
vi.mock("./database", () => ({ customersForUser: m.repo }));
import { handleCustomers } from "./customers-api";
const user = "550e8400-e29b-41d4-a716-446655440020",
  tenant = "550e8400-e29b-41d4-a716-446655440001",
  id = "550e8400-e29b-41d4-a716-446655440031",
  customer = {
    id,
    tenantId: tenant,
    name: "Ada",
    status: "active",
    createdAt: "2026-10-03T12:00:00Z",
  };
function request(
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
  q = "",
) {
  return new Request("https://example.test/api/v1/customers" + q, {
    method,
    headers: {
      "x-tenant-id": tenant,
      origin: "https://example.test",
      "content-type": "application/json",
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue(user);
  m.repo.mockReturnValue({
    listCustomers: m.list,
    createCustomer: m.create,
    readCustomer: m.read,
    updateCustomer: m.update,
  });
  m.list.mockResolvedValue([customer]);
  m.create.mockResolvedValue(customer);
  m.update.mockResolvedValue(customer);
  m.read.mockResolvedValue({ customer, sales: [] });
});
it("requires verified session before database", async () => {
  m.user.mockResolvedValue(null);
  expect((await handleCustomers(request(), "list")).status).toBe(401);
  expect(m.repo).not.toHaveBeenCalled();
});
it("search uses verified server context and bounded supported parameters", async () => {
  expect(
    (
      await handleCustomers(
        request("GET", undefined, { "x-user-id": "forged" }, "?q=ada"),
        "list",
      )
    ).status,
  ).toBe(200);
  expect(m.repo).toHaveBeenCalledWith(user, tenant, expect.any(String));
  expect(m.list).toHaveBeenCalledWith("ada");
  for (const q of ["?q=one&q=two", "?email=anything", "?q=" + "x".repeat(201)])
    expect(
      (await handleCustomers(request("GET", undefined, {}, q), "list")).status,
    ).toBe(400);
});
it("create validates strict fields and CSRF", async () => {
  const data = { id, name: "Ada", status: "active" };
  expect((await handleCustomers(request("POST", data), "create")).status).toBe(
    201,
  );
  for (const extra of [
    { role: "owner" },
    { userId: user },
    { tenantId: tenant },
    { rfc: "X" },
    { phone: 123 },
  ])
    expect(
      (await handleCustomers(request("POST", { ...data, ...extra }), "create"))
        .status,
    ).toBe(400);
  expect(
    (
      await handleCustomers(
        request("POST", data, { origin: "https://evil.test" }),
        "create",
      )
    ).status,
  ).toBe(403);
});
it("patch forwards only explicit fields including clearing optional contacts", async () => {
  expect(
    (
      await handleCustomers(
        request("PATCH", { phone: null, email: null, notes: null }),
        "update",
        id,
      )
    ).status,
  ).toBe(200);
  expect(m.update).toHaveBeenCalledWith(id, {
    phone: null,
    email: null,
    notes: null,
  });
  expect(
    (
      await handleCustomers(
        request("PATCH", { createdAt: "now" }),
        "update",
        id,
      )
    ).status,
  ).toBe(400);
});
it("permissions and hidden customer are sanitized", async () => {
  m.list.mockRejectedValue(new PermissionDeniedError());
  expect((await handleCustomers(request(), "list")).status).toBe(403);
  m.read.mockRejectedValue(new CustomerNotFoundError());
  expect((await handleCustomers(request(), "read", id)).status).toBe(404);
});
it("history serializes exact money and unexpected errors exclude SQL and personal data", async () => {
  m.read.mockResolvedValue({
    customer,
    sales: [
      {
        id,
        createdAt: customer.createdAt,
        total: money(123n),
        paymentMethods: ["cash"],
        returnedTotal: money(23n),
      },
    ],
  });
  const result = await handleCustomers(request(), "read", id);
  expect((await result.json()).sales[0].returnedTotal.minorUnits).toBe("23");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    m.create.mockRejectedValue(
      new Error("SQL leaked email private@example.invalid"),
    );
    const r = await handleCustomers(
      request("POST", { id, name: "Ada", status: "active" }),
      "create",
    );
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("SQL");
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private@example.invalid",
    );
  } finally {
    log.mockRestore();
  }
});

import { beforeEach, expect, it, vi } from "vitest";
import {
  PermissionDeniedError,
  SupportUnavailableError,
  SupportConflictError,
  SupportRateLimitError,
} from "@smartretail/application";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  factory: vi.fn(),
  platform: vi.fn(),
  access: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  changeStatus: vi.fn(),
  initialSetup: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ verifiedUserId: m.user }));
vi.mock("./database", () => ({
  supportForUser: m.factory,
  platformForUser: m.platform,
}));
import { handleSupport } from "./support-api";
const id = "550e8400-e29b-41d4-a716-446655440020",
  tenant = "550e8400-e29b-41d4-a716-446655440001";
const body = {
  id,
  category: "error",
  subject: "Caja",
  description: "No puedo abrir",
  pagePath: "/cash",
};
const req = (value?: unknown, headers = {}, query = "") =>
  new Request("https://example.test/api/v1/support" + query, {
    method: value === undefined ? "GET" : "POST",
    headers: {
      origin: "https://example.test",
      "content-type": "application/json",
      "x-tenant-id": tenant,
      ...headers,
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue(id);
  m.factory.mockReturnValue(m);
  m.platform.mockReturnValue(m);
  m.access.mockResolvedValue(true);
  m.create.mockResolvedValue({ ...body, status: "open" });
  m.list.mockResolvedValue({ requests: [], hasMore: false });
  m.detail.mockResolvedValue(body);
  m.changeStatus.mockResolvedValue({ ...body, status: "closed" });
});
it("requires a verified session before resolving a tenant", async () => {
  m.user.mockResolvedValue(null);
  expect((await handleSupport(req(), "list")).status).toBe(401);
  expect(m.factory).not.toHaveBeenCalled();
});
it("creates using the verified actor and chosen tenant only", async () => {
  expect((await handleSupport(req(body), "create")).status).toBe(201);
  expect(m.factory).toHaveBeenCalledWith(id, tenant, false);
  expect(m.create.mock.calls[0]?.[0]).toEqual(body);
});
it("rejects forged identity and oversized bodies before persistence", async () => {
  for (const patch of [
    { role: "owner" },
    { tenantId: id },
    { description: "x".repeat(17000) },
  ])
    expect(
      (await handleSupport(req({ ...body, ...patch }), "create")).status,
    ).toBe(400);
  expect(m.create).not.toHaveBeenCalled();
});
it("rejects cross-origin mutations", async () => {
  expect(
    (
      await handleSupport(
        req(body, { origin: "https://attacker.test" }),
        "create",
      )
    ).status,
  ).toBe(403);
  expect(m.create).not.toHaveBeenCalled();
});
it("maps inaccessible tenant and ticket to sanitized responses", async () => {
  m.list.mockRejectedValueOnce(new PermissionDeniedError());
  expect((await handleSupport(req(), "list")).status).toBe(403);
  m.detail.mockRejectedValueOnce(new SupportUnavailableError());
  expect((await handleSupport(req(), "detail", id)).status).toBe(404);
});
it("denies platform support before listing to ordinary members", async () => {
  m.access.mockResolvedValue(false);
  expect((await handleSupport(req(), "list", undefined, true)).status).toBe(
    403,
  );
  expect(m.list).not.toHaveBeenCalled();
});
it("platform status updates use the same separate authorization", async () => {
  expect(
    (await handleSupport(req({ status: "closed" }), "status", id, true)).status,
  ).toBe(200);
  expect(m.changeStatus).toHaveBeenCalledWith(id, "closed", expect.any(String));
  expect(
    (await handleSupport(req({ status: "closed" }), "status", id)).status,
  ).toBe(403);
});
it("rejects duplicate, unknown and invalid pagination query", async () => {
  for (const q of ["?page=1&page=2", "?role=owner", "?page=0"])
    expect((await handleSupport(req(undefined, {}, q), "list")).status).toBe(
      400,
    );
});
it("maps idempotency conflicts and submission limit without losing report", async () => {
  m.create.mockRejectedValueOnce(new SupportConflictError());
  expect((await handleSupport(req(body), "create")).status).toBe(409);
  m.create.mockRejectedValueOnce(new SupportRateLimitError());
  expect((await handleSupport(req(body), "create")).status).toBe(429);
});
it("does not expose SQL errors or private metadata", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  m.create.mockRejectedValue(new Error("password=secret SQL syntax"));
  const r = await handleSupport(req(body), "create");
  expect(r.status).toBe(500);
  expect(JSON.stringify(await r.json())).not.toContain("secret");
  expect(spy.mock.calls[0]?.[1]).toEqual({ correlationId: expect.any(String) });
  spy.mockRestore();
});

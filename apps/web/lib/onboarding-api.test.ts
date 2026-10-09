import { beforeEach, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "@smartretail/application";
import {
  OnboardingConflictError,
  InvitationUnavailableError,
} from "@smartretail/database";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  factory: vi.fn(),
  tenants: vi.fn(),
  inventory: vi.fn(),
  onboard: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  accept: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ verifiedUserId: m.user }));
vi.mock("./database", () => ({
  onboardingForUser: m.factory,
  tenantsForUser: m.tenants,
  inventoryForUser: m.inventory,
}));
import { handleOnboarding } from "./onboarding-api";
const id = "550e8400-e29b-41d4-a716-446655440020",
  tenant = "550e8400-e29b-41d4-a716-446655440001";
const body = {
  commandId: id,
  businessName: "Empresa",
  tradeName: null,
  phone: null,
  email: null,
  branchName: "Centro",
};
const invite = {
  email: "NEW@example.test",
  role: "cashier",
  locationIds: [],
  expiresInDays: 7,
};
function request(value?: unknown, headers = {}, query = "") {
  return new Request("https://example.test/api/v1/onboarding" + query, {
    method: value === undefined ? "GET" : "POST",
    headers: {
      origin: "https://example.test",
      "content-type": "application/json",
      "x-tenant-id": tenant,
      ...headers,
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue(id);
  m.factory.mockReturnValue(m);
  m.tenants.mockResolvedValue([]);
  m.inventory.mockReturnValue({ listLocations: async () => [] });
  m.onboard.mockResolvedValue({ tenantId: tenant, locationId: id });
  m.list.mockResolvedValue([]);
  m.create.mockResolvedValue({ id });
  m.accept.mockResolvedValue({ tenantId: tenant });
});
it("requires verified session before repository use and ignores client identity", async () => {
  m.user.mockResolvedValueOnce(null);
  expect(
    (await handleOnboarding(request(body, { "x-user-id": id }), "onboard"))
      .status,
  ).toBe(401);
  expect(m.factory).not.toHaveBeenCalled();
  expect((await handleOnboarding(request(), "status")).status).toBe(200);
  expect(m.factory).toHaveBeenCalledWith(id);
});
it("validates same-origin and strict onboarding intent before persistence", async () => {
  expect(
    (
      await handleOnboarding(
        request(body, { origin: "https://evil.test" }),
        "onboard",
      )
    ).status,
  ).toBe(403);
  expect(
    (await handleOnboarding(request({ ...body, role: "owner" }), "onboard"))
      .status,
  ).toBe(400);
  expect(m.onboard).not.toHaveBeenCalled();
  expect((await handleOnboarding(request(body), "onboard")).status).toBe(201);
  expect(m.onboard).toHaveBeenCalledWith(body, expect.any(String));
});
it("generates token server-side and stores only its SHA256 hash", async () => {
  const result = await handleOnboarding(request(invite), "create"),
    value = await result.json();
  expect(result.status).toBe(201);
  expect(value.token).toMatch(/^[a-f0-9]{64}$/);
  expect(m.create).toHaveBeenCalledWith(
    tenant,
    { ...invite, email: "new@example.test" },
    expect.stringMatching(/^[a-f0-9]{64}$/),
    expect.any(String),
  );
  expect(m.create.mock.calls[0]?.[2]).not.toBe(value.token);
});
it("acceptance derives identity server-side and never forwards the plaintext token", async () => {
  const token = "a".repeat(64);
  expect(
    (
      await handleOnboarding(
        request({ token, email: "other@example.test" }),
        "accept",
      )
    ).status,
  ).toBe(400);
  expect((await handleOnboarding(request({ token }), "accept")).status).toBe(
    200,
  );
  expect(m.accept.mock.calls[0]?.[0]).not.toBe(token);
  expect(m.accept.mock.calls[0]?.[0]).toMatch(/^[a-f0-9]{64}$/);
});
it("checks manager before reading locations and rejects forged scopes or parameters", async () => {
  m.list.mockRejectedValueOnce(new PermissionDeniedError());
  expect((await handleOnboarding(request(), "list")).status).toBe(403);
  expect(m.inventory).not.toHaveBeenCalled();
  expect(
    (await handleOnboarding(request(undefined, {}, "?role=owner"), "list"))
      .status,
  ).toBe(400);
  expect(
    (
      await handleOnboarding(
        request({}, { "x-tenant-id": "invalid" }),
        "revoke",
        id,
      )
    ).status,
  ).toBe(400);
});
it("sanitizes conflicts, unavailable invitations and unexpected storage errors", async () => {
  m.accept.mockRejectedValueOnce(new OnboardingConflictError());
  expect(
    (await handleOnboarding(request({ token: "a".repeat(64) }), "accept"))
      .status,
  ).toBe(409);
  m.accept.mockRejectedValueOnce(new InvitationUnavailableError());
  expect(
    (await handleOnboarding(request({ token: "a".repeat(64) }), "accept"))
      .status,
  ).toBe(404);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  m.onboard.mockRejectedValueOnce(new Error("SQL private data"));
  const r = await handleOnboarding(request(body), "onboard");
  expect(r.status).toBe(500);
  expect(JSON.stringify(await r.json())).not.toContain("SQL");
  expect(JSON.stringify(log.mock.calls)).not.toContain("SQL private");
  log.mockRestore();
});

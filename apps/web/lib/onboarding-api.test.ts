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
  email: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ verifiedUserId: m.user }));
vi.mock("./invitation-email", () => ({ sendInvitationEmail: m.email }));
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
  m.create.mockResolvedValue({
    id,
    email: "new@example.test",
    role: "cashier",
    locationIds: [],
    expiresAt: "2099-01-01T00:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
  });
  m.email.mockResolvedValue({ status: "not_sent" });
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

for (const status of ["accepted", "not_sent", "unknown"] as const)
  it(`keeps a persisted invitation and private link when email is ${status}`, async () => {
    m.email.mockResolvedValue({ status });
    const response = await handleOnboarding(request(invite), "create");
    const value = await response.json();
    expect(response.status).toBe(201);
    expect(value.token).toMatch(/^[a-f0-9]{64}$/);
    expect(value.emailDelivery).toEqual({ status });
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.email).toHaveBeenCalledOnce();
    expect(m.create.mock.invocationCallOrder[0]).toBeLessThan(
      m.email.mock.invocationCallOrder[0]!,
    );
    expect(m.email).toHaveBeenCalledWith(
      await m.create.mock.results[0]!.value,
      value.token,
    );
  });

it("uses the persisted recipient and never request identity or routing fields for mail", async () => {
  const persisted = {
    id,
    email: "persisted@example.test",
    role: "inventory_clerk",
    locationIds: [id],
    expiresAt: "2099-01-01T00:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
  };
  m.create.mockResolvedValue(persisted);
  await handleOnboarding(
    request(invite, { "x-user-id": tenant, "x-forwarded-host": "evil.test" }),
    "create",
  );
  expect(m.factory).toHaveBeenCalledWith(id);
  expect(m.email.mock.calls[0]?.[0]).toEqual(persisted);
});

it("does not send for unauthenticated, unauthorized, cross-origin, forbidden role or foreign branch requests", async () => {
  m.user.mockResolvedValueOnce(null);
  expect((await handleOnboarding(request(invite), "create")).status).toBe(401);
  expect(
    (
      await handleOnboarding(
        request(invite, { origin: "https://evil.test" }),
        "create",
      )
    ).status,
  ).toBe(403);
  for (const value of [
    { ...invite, role: "owner" },
    { ...invite, role: "platform_admin" },
    { ...invite, role: "admin", locationIds: [id] },
    { ...invite, recipient: "forged@example.test" },
  ])
    expect((await handleOnboarding(request(value), "create")).status).toBe(400);
  expect(m.create).not.toHaveBeenCalled();
  m.create.mockRejectedValue(new PermissionDeniedError());
  expect((await handleOnboarding(request(invite), "create")).status).toBe(403);
  expect(
    (
      await handleOnboarding(
        request({ ...invite, locationIds: [id] }),
        "create",
      )
    ).status,
  ).toBe(403);
  expect(m.email).not.toHaveBeenCalled();
});

it("does not turn an unexpected mail failure into creation failure or leak its details", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  m.email.mockRejectedValue(new Error("PRIVATE_PROVIDER_DETAIL"));
  const response = await handleOnboarding(request(invite), "create");
  const value = await response.json();
  expect(response.status).toBe(201);
  expect(value.emailDelivery).toEqual({ status: "unknown" });
  expect(value.token).toMatch(/^[a-f0-9]{64}$/);
  expect(m.create).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(log.mock.calls)).not.toContain(value.token);
  expect(JSON.stringify(log.mock.calls)).not.toContain("new@example.test");
  expect(JSON.stringify(value)).not.toContain("PRIVATE_PROVIDER_DETAIL");
  log.mockRestore();
});

it("waits for committed persistence before attempting mail", async () => {
  const persisted = await m.create();
  m.create.mockClear();
  let complete!: (value: typeof persisted) => void;
  const pending = new Promise<typeof persisted>((resolve) => {
    complete = resolve;
  });
  m.create.mockReturnValue(pending);
  const response = handleOnboarding(request(invite), "create");
  await vi.waitFor(() => expect(m.create).toHaveBeenCalledOnce());
  expect(m.email).not.toHaveBeenCalled();
  complete(persisted);
  expect((await response).status).toBe(201);
  expect(m.email).toHaveBeenCalledOnce();
});

it("reuses the unique persisted token hash across concurrent and later retries, without another mail", async () => {
  const persisted = await m.create();
  m.create.mockClear();
  const hashes = new Set<string>();
  m.create.mockImplementation(async (_tenant, _intent, hash) => {
    if (hashes.has(hash))
      throw Object.assign(new Error("PRIVATE_SQL"), {
        code: "23505",
        constraint: "tenant_invitations_token_hash_key",
      });
    hashes.add(hash);
    return persisted;
  });
  const payload = { ...invite, creationNonce: "c".repeat(64) };
  const responses = await Promise.all([
    handleOnboarding(request(payload), "create"),
    handleOnboarding(request(payload), "create"),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  const retry = await handleOnboarding(request(payload), "create");
  expect(retry.status).toBe(409);
  expect(JSON.stringify(await retry.json())).not.toContain("PRIVATE_SQL");
  expect(hashes.size).toBe(1);
  expect(m.email).toHaveBeenCalledOnce();
  expect(m.create.mock.calls.every((c) => !("creationNonce" in c[1]))).toBe(
    true,
  );
});

it("scopes creation nonces to the verified actor and company and rejects malformed nonces", async () => {
  for (const creationNonce of ["", "c".repeat(63), "C".repeat(64), 42])
    expect(
      (await handleOnboarding(request({ ...invite, creationNonce }), "create"))
        .status,
    ).toBe(400);
  expect(m.create).not.toHaveBeenCalled();
  const payload = { ...invite, creationNonce: "c".repeat(64) };
  const first = await (
    await handleOnboarding(request(payload), "create")
  ).json();
  m.user.mockResolvedValue(tenant);
  const second = await (
    await handleOnboarding(request(payload), "create")
  ).json();
  const third = await (
    await handleOnboarding(request(payload, { "x-tenant-id": id }), "create")
  ).json();
  expect(new Set([first.token, second.token, third.token]).size).toBe(3);
});

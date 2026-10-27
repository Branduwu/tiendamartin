import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  server: vi.fn(),
  user: vi.fn(),
  update: vi.fn(),
  tenants: vi.fn(),
  platform: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./supabase/server", () => ({ serverAuth: m.server }));
vi.mock("./database", () => ({
  tenantsForUser: m.tenants,
  platformForUser: () => ({ access: m.platform }),
}));
import { handleProfile } from "./profile-api";
const id = "550e8400-e29b-41d4-a716-446655440020";
let stored: {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
};
const input = { firstName: "Ana", lastName: "Pérez", phone: "555-1234" };
function request(method = "GET", body?: unknown, query = "", headers = {}) {
  return new Request("https://example.test/api/v1/profile" + query, {
    method,
    headers: {
      origin: "https://example.test",
      "content-type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PROFILE_PHOTOS_ENABLED", "false");
  stored = {
    id,
    email: "self@example.invalid",
    user_metadata: {
      first_name: "Original",
      role: "owner",
      secret: "PRIVATE_METADATA",
    },
  };
  m.server.mockResolvedValue({
    auth: { getUser: m.user, updateUser: m.update },
  });
  m.user.mockImplementation(async () => ({
    data: { user: stored },
    error: null,
  }));
  m.update.mockImplementation(async ({ data }) => {
    stored = { ...stored, user_metadata: { ...stored.user_metadata, ...data } };
    return { data: { user: stored }, error: null };
  });
  m.tenants.mockResolvedValue([
    { tenantName: "Negocio propio", tenantStatus: "active", role: "cashier" },
  ]);
  m.platform.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllEnvs());
it("reads only the verified user's data and authoritative membership roles", async () => {
  const r = await handleProfile(request());
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    firstName: "Original",
    email: stored.email,
    roles: [{ company: "Negocio propio", role: "cashier" }],
    platformAdmin: false,
    photoEnabled: false,
  });
  expect(m.tenants).toHaveBeenCalledWith(id);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
});
it("summary exposes only presentation and avoids membership queries", async () => {
  const value = await (
    await handleProfile(request("GET", undefined, "?summary=1"))
  ).json();
  expect(value).toEqual({ displayName: "Original", photoEnabled: false });
  expect(m.tenants).not.toHaveBeenCalled();
  expect(m.platform).not.toHaveBeenCalled();
});
it("persists whitelisted fields across independent requests without touching privileged metadata or sessions", async () => {
  const r = await handleProfile(request("PATCH", input));
  expect(r.status).toBe(200);
  expect(m.update).toHaveBeenCalledWith({
    data: {
      first_name: "Ana",
      last_name: "Pérez",
      profile_phone: "555-1234",
      full_name: "Ana Pérez",
      display_name: "Ana Pérez",
    },
  });
  const reload = await (await handleProfile(request())).json();
  expect(reload).toMatchObject({
    ...input,
    displayName: "Ana Pérez",
    roles: [{ role: "cashier" }],
  });
  expect(JSON.stringify(reload)).not.toContain("PRIVATE_METADATA");
  expect(stored.user_metadata.role).toBe("owner");
});
it("requires valid verified identity before queries or updates", async () => {
  m.user.mockResolvedValue({
    data: { user: null },
    error: { message: "PRIVATE" },
  });
  expect((await handleProfile(request())).status).toBe(401);
  expect((await handleProfile(request("PATCH", input))).status).toBe(401);
  expect(m.tenants).not.toHaveBeenCalled();
  expect(m.update).not.toHaveBeenCalled();
  m.server.mockResolvedValue(null);
  expect((await handleProfile(request())).status).toBe(503);
});
it("rejects another user's target and all privilege or credential input", async () => {
  for (const field of [
    "userId",
    "email",
    "role",
    "roles",
    "tenantId",
    "permissions",
    "app_metadata",
    "user_metadata",
    "password",
    "avatar_url",
  ])
    expect(
      (await handleProfile(request("PATCH", { ...input, [field]: "other" })))
        .status,
    ).toBe(400);
  expect(
    (await handleProfile(request("GET", undefined, "?userId=" + id))).status,
  ).toBe(400);
  expect(m.update).not.toHaveBeenCalled();
});
it("rejects cross-origin mutations and malformed or oversized inputs", async () => {
  expect(
    (
      await handleProfile(
        request("PATCH", input, "", { origin: "https://evil.invalid" }),
      )
    ).status,
  ).toBe(403);
  expect(
    (await handleProfile(request("PATCH", { ...input, firstName: "" }))).status,
  ).toBe(400);
  expect(
    (
      await handleProfile(
        request("PATCH", { ...input, firstName: "x".repeat(20000) }),
      )
    ).status,
  ).toBe(400);
  expect((await handleProfile(request("DELETE"))).status).toBe(405);
  expect(m.update).not.toHaveBeenCalled();
});
it("treats provider rejection as unsaved without leaking provider messages", async () => {
  m.update.mockResolvedValue({
    data: { user: null },
    error: { status: 422, message: "PRIVATE_DETAIL" },
  });
  const r = await handleProfile(request("PATCH", input));
  expect(r.status).toBe(400);
  expect(JSON.stringify(await r.json())).not.toContain("PRIVATE_DETAIL");
  expect(m.update).toHaveBeenCalledOnce();
});
it("reconciles an applied write with lost response through a read, without automatic retry", async () => {
  m.update.mockImplementation(async ({ data }) => {
    stored.user_metadata = { ...stored.user_metadata, ...data };
    throw Error("PRIVATE_DETAIL");
  });
  const r = await handleProfile(request("PATCH", input));
  expect(r.status).toBe(503);
  expect(await r.json()).toMatchObject({ code: "profile_update_unconfirmed" });
  expect(await (await handleProfile(request())).json()).toMatchObject(input);
  expect(m.update).toHaveBeenCalledOnce();
});
it("sanitizes audit and refuses an unexpected returned identity", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  await handleProfile(request("PATCH", input));
  expect(JSON.stringify(log.mock.calls)).not.toContain("Pérez");
  expect(JSON.stringify(log.mock.calls)).not.toContain(stored.email);
  m.update.mockResolvedValue({
    data: { user: { ...stored, id: "550e8400-e29b-41d4-a716-446655440099" } },
    error: null,
  });
  expect((await handleProfile(request("PATCH", input))).status).toBe(503);
  log.mockRestore();
});

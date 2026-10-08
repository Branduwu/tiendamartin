import { beforeEach, expect, it, vi } from "vitest";
import {
  defaultBusinessProfile,
  PermissionDeniedError,
} from "@smartretail/application";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  branch: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ verifiedUserId: m.user }));
vi.mock("./database", () => ({ businessForUser: m.repo }));
import { handleBusiness } from "./business-api";
const user = "550e8400-e29b-41d4-a716-446655440020",
  tenant = "550e8400-e29b-41d4-a716-446655440001";
const request = (body?: unknown, headers = {}) =>
  new Request("https://example.test/api/v1/business", {
    method: body === undefined ? "GET" : "PUT",
    headers: {
      "x-tenant-id": tenant,
      origin: "https://example.test",
      "content-type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue(user);
  m.repo.mockReturnValue({ read: m.read, save: m.save, saveBranch: m.branch });
  m.read.mockResolvedValue({ profile: defaultBusinessProfile, branches: [] });
  m.save.mockResolvedValue({ profile: defaultBusinessProfile });
});
it("requires Auth and composes only verified actor and tenant despite forged role", async () => {
  m.user.mockResolvedValueOnce(null);
  expect((await handleBusiness(request(), "read")).status).toBe(401);
  expect(m.repo).not.toHaveBeenCalled();
  const r = await handleBusiness(
    request(undefined, { "x-role": "owner", "x-user-id": "forged" }),
    "read",
  );
  expect(r.status).toBe(200);
  expect(m.repo).toHaveBeenCalledWith(user, tenant);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
});
it("bounds writes, rejects CSRF and extra fields, and preserves server permission denial", async () => {
  expect(
    (
      await handleBusiness(
        request({ ...defaultBusinessProfile, role: "owner" }),
        "save",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handleBusiness(
        request(defaultBusinessProfile, { origin: "https://other.test" }),
        "save",
      )
    ).status,
  ).toBe(403);
  expect(m.save).not.toHaveBeenCalled();
  m.save.mockRejectedValueOnce(new PermissionDeniedError());
  expect(
    (await handleBusiness(request(defaultBusinessProfile), "save")).status,
  ).toBe(403);
  expect(m.save).toHaveBeenCalledWith(
    defaultBusinessProfile,
    expect.any(String),
  );
});
it("validates branch id and returns sanitized failures without SQL details", async () => {
  expect(
    (
      await handleBusiness(
        request({
          displayName: null,
          address: null,
          phone: null,
          receiptHeader: null,
          status: "active",
        }),
        "branch",
        "bad",
      )
    ).status,
  ).toBe(400);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    m.read.mockRejectedValueOnce(new Error("private SQL detail"));
    const r = await handleBusiness(request(), "read");
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("SQL");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private SQL");
  } finally {
    log.mockRestore();
  }
});

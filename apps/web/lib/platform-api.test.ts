import { beforeEach, expect, it, vi } from "vitest";
import {
  PermissionDeniedError,
  PlatformCompanyConflictError,
  PlatformCompanyNotFoundError,
} from "@smartretail/application";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  access: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  users: vi.fn(),
  create: vi.fn(),
  changeStatus: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ verifiedUserId: m.user }));
vi.mock("./database", () => ({ platformForUser: m.repo }));
import { handlePlatform } from "./platform-api";
const actor = "550e8400-e29b-41d4-a716-446655440020",
  id = "550e8400-e29b-41d4-a716-446655440001",
  body = { id, displayName: "Empresa", ownerUserId: actor };
function request(value?: unknown, headers = {}, query = "") {
  return new Request("https://example.test/api/v1/platform/companies" + query, {
    method: value === undefined ? "GET" : "POST",
    headers: {
      origin: "https://example.test",
      "content-type": "application/json",
      ...headers,
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue(actor);
  m.repo.mockReturnValue(m);
  m.access.mockResolvedValue(true);
  m.list.mockResolvedValue({ companies: [] });
  m.users.mockResolvedValue([]);
  m.create.mockResolvedValue({ id });
  m.changeStatus.mockResolvedValue({ saved: true });
});
it("requires verified Auth and refuses forged platform identity", async () => {
  m.user.mockResolvedValueOnce(null);
  expect((await handlePlatform(request(), "list")).status).toBe(401);
  expect(m.repo).not.toHaveBeenCalled();
  m.access.mockResolvedValue(false);
  expect(
    (
      await handlePlatform(
        request(undefined, { "x-role": "platform_admin", "x-user-id": id }),
        "users",
      )
    ).status,
  ).toBe(403);
  expect(m.repo).toHaveBeenCalledWith(actor);
  expect(m.users).not.toHaveBeenCalled();
});
it("validates strict paging and limits Auth directory behind platform gate", async () => {
  for (const query of ["?page=01", "?page=1&page=2", "?role=owner"])
    expect(
      (await handlePlatform(request(undefined, {}, query), "list")).status,
    ).toBe(400);
  const r = await handlePlatform(
    request(undefined, {}, "?page=2&search=example"),
    "users",
  );
  expect(r.status).toBe(200);
  expect(m.users).toHaveBeenCalledWith("example", 2);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
});
it("rejects CSRF, extra privileges and oversized writes without mutations", async () => {
  expect(
    (
      await handlePlatform(
        request(body, { origin: "https://other.test" }),
        "create",
      )
    ).status,
  ).toBe(403);
  expect(
    (await handlePlatform(request({ ...body, role: "owner" }), "create"))
      .status,
  ).toBe(400);
  expect(
    (
      await handlePlatform(
        request({ ...body, displayName: "a".repeat(17000) }),
        "create",
      )
    ).status,
  ).toBe(400);
  expect(m.create).not.toHaveBeenCalled();
});
it("passes only validated command and server correlation and maps replay conflicts", async () => {
  expect((await handlePlatform(request(body), "create")).status).toBe(201);
  expect(m.create).toHaveBeenCalledWith(body, expect.any(String));
  m.create.mockRejectedValueOnce(new PlatformCompanyConflictError());
  expect((await handlePlatform(request(body), "create")).status).toBe(409);
});
it("validates status and identifiers and preserves database permission denial", async () => {
  expect(
    (
      await handlePlatform(
        request({ status: "deleted", commandId: id }),
        "status",
        id,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handlePlatform(
        request({ status: "active", commandId: id }),
        "status",
        "bad",
      )
    ).status,
  ).toBe(400);
  m.changeStatus.mockRejectedValueOnce(new PermissionDeniedError());
  expect(
    (
      await handlePlatform(
        request({ status: "suspended", commandId: id }),
        "status",
        id,
      )
    ).status,
  ).toBe(403);
  m.detail.mockRejectedValueOnce(new PlatformCompanyNotFoundError());
  expect((await handlePlatform(request(), "detail", id)).status).toBe(404);
});
it("sanitizes unexpected SQL errors and logs only correlation", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    m.list.mockRejectedValueOnce(new Error("private SQL credentials"));
    const r = await handlePlatform(request(), "list");
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("SQL");
    expect(JSON.stringify(log.mock.calls)).not.toContain("credentials");
  } finally {
    log.mockRestore();
  }
});

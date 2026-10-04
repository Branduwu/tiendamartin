import { beforeEach, it, expect, vi } from "vitest";
import { PermissionDeniedError } from "@smartretail/application";
import { MemberStateConflictError } from "@smartretail/database";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  repo: vi.fn(),
  inventory: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  locations: vi.fn(),
}));
vi.mock("./auth", () => ({ verifiedUserId: mocks.user }));
vi.mock("./database", () => ({
  membersForUser: mocks.repo,
  inventoryForUser: mocks.inventory,
}));
import { handleMembers } from "./members-api";
const user = "550e8400-e29b-41d4-a716-446655440001";
const tenant = "550e8400-e29b-41d4-a716-446655440002";
const target = "550e8400-e29b-41d4-a716-446655440003";
const input = {
  role: "cashier",
  status: "active",
  displayName: "Ana",
  locationIds: [],
};
const member = { ...input, userId: target, allLocations: false };
function request(
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
  query = "",
) {
  return new Request("https://example.test/api/v1/members" + query, {
    method,
    headers: {
      "x-tenant-id": tenant,
      origin: "https://example.test",
      "content-type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(user);
  mocks.repo.mockReturnValue({
    listMembers: mocks.list,
    updateMember: mocks.update,
  });
  mocks.inventory.mockReturnValue({ listLocations: mocks.locations });
  mocks.list.mockResolvedValue([member]);
  mocks.update.mockResolvedValue(member);
  mocks.locations.mockResolvedValue([]);
});
it("requires verified session and ignores forged identity/role headers", async () => {
  mocks.user.mockResolvedValue(null);
  expect(
    (
      await handleMembers(
        request("GET", undefined, { "x-user-id": user, "x-role": "owner" }),
        "list",
      )
    ).status,
  ).toBe(401);
  expect(mocks.repo).not.toHaveBeenCalled();
  mocks.user.mockResolvedValue(user);
  const response = await handleMembers(
    request("GET", undefined, { "x-user-id": target, "x-role": "owner" }),
    "list",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ members: [member], locations: [] });
  expect(mocks.repo).toHaveBeenCalledWith(user, tenant, expect.any(String));
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("does not fetch locations when members.manage is denied", async () => {
  mocks.list.mockRejectedValue(new PermissionDeniedError());
  expect((await handleMembers(request(), "list")).status).toBe(403);
  expect(mocks.inventory).not.toHaveBeenCalled();
  mocks.update.mockRejectedValue(new PermissionDeniedError());
  expect(
    (await handleMembers(request("PATCH", input), "update", target)).status,
  ).toBe(403);
});
it("patch accepts only strict explicit fields with a valid target and same-origin request", async () => {
  expect(
    (await handleMembers(request("PATCH", input), "update", target)).status,
  ).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith(target, input);
  for (const extra of [
    { role: "owner" },
    { role: "admin", locationIds: [target] },
    { tenantId: tenant },
    { userId: user },
    { allLocations: true },
  ])
    expect(
      (
        await handleMembers(
          request("PATCH", { ...input, ...extra }),
          "update",
          target,
        )
      ).status,
    ).toBe(400);
  expect(
    (await handleMembers(request("PATCH", input), "update", "invalid")).status,
  ).toBe(400);
  expect(
    (
      await handleMembers(
        request("PATCH", input, { origin: "https://evil.test" }),
        "update",
        target,
      )
    ).status,
  ).toBe(403);
  expect(mocks.update).toHaveBeenCalledTimes(1);
});
it("rejects unsupported queries, invalid tenant and excessive body before mutation", async () => {
  expect(
    (await handleMembers(request("GET", undefined, {}, "?role=owner"), "list"))
      .status,
  ).toBe(400);
  expect(
    (
      await handleMembers(
        request("GET", undefined, { "x-tenant-id": "invalid" }),
        "list",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handleMembers(
        request("PATCH", { ...input, displayName: "x".repeat(17000) }),
        "update",
        target,
      )
    ).status,
  ).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("sanitizes state conflicts and unexpected SQL errors without logging personal input", async () => {
  mocks.update.mockRejectedValue(new MemberStateConflictError());
  expect(
    (await handleMembers(request("PATCH", input), "update", target)).status,
  ).toBe(409);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mocks.update.mockRejectedValue(
      new Error("SQL private-person@example.invalid"),
    );
    const response = await handleMembers(
      request("PATCH", input),
      "update",
      target,
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/SQL|private-person/);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /SQL|private-person|displayName/,
    );
  } finally {
    log.mockRestore();
  }
});

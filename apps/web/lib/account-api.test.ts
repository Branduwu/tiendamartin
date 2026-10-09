import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  server: vi.fn(),
  recovery: vi.fn(),
  clear: vi.fn(),
  exchange: vi.fn(),
  claims: vi.fn(),
  user: vi.fn(),
  update: vi.fn(),
  end: vi.fn(),
  reauth: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./supabase/server", () => ({ serverAuth: m.server }));
vi.mock("./supabase/recovery", () => ({
  recoveryAuth: m.recovery,
  clearAuthCookies: m.clear,
}));
import { handleAccount, INVALID_RECOVERY } from "./account-api";
const id = "550e8400-e29b-41d4-a716-446655440020",
  password = "Contraseña nueva \"😊 O'Connor9!";
const reset = { code: "opaque-test-code", password, confirmation: password };
const change = {
  password,
  confirmation: password,
  currentPassword: "Contraseña anterior",
};
function request(body: unknown, headers = {}) {
  return new Request("https://example.test/api/auth/password", {
    method: "POST",
    headers: {
      origin: "https://example.test",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  const client = {
    auth: {
      admin: { signOut: m.revoke },
      exchangeCodeForSession: m.exchange,
      getClaims: m.claims,
      getUser: m.user,
      updateUser: m.update,
      signOut: m.end,
      reauthenticate: m.reauth,
    },
  };
  m.server.mockResolvedValue(client);
  m.recovery.mockResolvedValue(client);
  m.exchange.mockResolvedValue({
    data: { user: { id }, session: { access_token: "fake-test-only" } },
    error: null,
  });
  m.claims.mockResolvedValue({
    data: {
      claims: {
        sub: id,
        session_id: "test-session",
        amr: [{ method: "recovery" }],
      },
    },
    error: null,
  });
  m.user.mockResolvedValue({ data: { user: { id } }, error: null });
  m.update.mockResolvedValue({ error: null });
  m.end.mockResolvedValue({ error: null });
  m.reauth.mockResolvedValue({ error: null });
  m.revoke.mockResolvedValue({ error: null });
});
it("exchanges only an Auth code, verifies signed recovery and never uses an existing browser session", async () => {
  expect(
    (
      await handleAccount(
        request({ ...reset, flowId: "valid_flow_01" }),
        "reset",
      )
    ).status,
  ).toBe(200);
  expect(m.server).not.toHaveBeenCalled();
  expect(m.exchange).toHaveBeenCalledWith(reset.code, {
    flowId: "valid_flow_01",
  });
  expect(m.claims).toHaveBeenCalledWith("fake-test-only");
  expect(m.update).toHaveBeenCalledWith({ password });
  expect(m.end).toHaveBeenCalledWith({ scope: "global" });
  expect(m.clear).toHaveBeenCalledOnce();
});
it.each(["invalid", "expired", "replayed"])(
  "rejects %s recovery without changing password or revoking an unrelated session",
  async () => {
    m.exchange.mockResolvedValue({
      data: { session: null },
      error: { code: "otp_expired" },
    });
    const response = await handleAccount(request(reset), "reset");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: INVALID_RECOVERY });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.end).not.toHaveBeenCalled();
  },
);
it.each([
  { sub: id, session_id: "s", amr: [{ method: "password" }] },
  { sub: id, session_id: "s", amr: [{ method: "otp" }] },
  { sub: id, session_id: "s", amr: [{ method: "magiclink" }] },
  { sub: "another-actor", session_id: "s", amr: [{ method: "recovery" }] },
  { sub: id, amr: [{ method: "recovery" }] },
  { sub: id, session_id: "s", amr: [] },
])("denies untrusted or non-recovery signed context %#", async (claims) => {
  m.claims.mockResolvedValue({ data: { claims }, error: null });
  expect((await handleAccount(request(reset), "reset")).status).toBe(401);
  expect(m.update).not.toHaveBeenCalled();
  expect(m.end).toHaveBeenCalledWith({ scope: "local" });
  expect(m.clear).not.toHaveBeenCalled();
});
it("fails closed when signature validation fails", async () => {
  m.claims.mockResolvedValue({ data: null, error: { code: "bad_jwt" } });
  expect((await handleAccount(request(reset), "reset")).status).toBe(401);
  expect(m.update).not.toHaveBeenCalled();
});
it("requires current password for self-service change and closes sessions", async () => {
  expect((await handleAccount(request(change), "change")).status).toBe(200);
  expect(m.update).toHaveBeenCalledWith({
    password,
    current_password: change.currentPassword,
  });
  expect(m.recovery).not.toHaveBeenCalled();
  expect(m.end).toHaveBeenCalledWith({ scope: "global" });
});
it("denies password changes without a verified current user", async () => {
  m.user.mockResolvedValue({ data: { user: null }, error: null });
  expect((await handleAccount(request(change), "change")).status).toBe(401);
  expect(m.update).not.toHaveBeenCalled();
});
it("does not reveal provider error details or close sessions for wrong current password", async () => {
  m.update.mockResolvedValue({
    error: {
      code: "current_password_invalid",
      message: "SQL /private/token secret",
    },
  });
  const response = await handleAccount(request(change), "change");
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("SQL");
  expect(m.end).not.toHaveBeenCalled();
});
it("uses the official nonce when reauthentication is required", async () => {
  m.update.mockResolvedValueOnce({
    error: { code: "reauthentication_needed" },
  });
  expect((await handleAccount(request(change), "change")).status).toBe(409);
  expect((await handleAccount(request({}), "reauthenticate")).status).toBe(200);
  expect(m.reauth).toHaveBeenCalledOnce();
  expect(
    (await handleAccount(request({ ...change, nonce: "123456" }), "change"))
      .status,
  ).toBe(200);
  expect(m.update).toHaveBeenLastCalledWith({
    password,
    current_password: change.currentPassword,
    nonce: "123456",
  });
});
it("reports reauthentication limits without details", async () => {
  m.reauth.mockResolvedValue({ error: { message: "personal@example.test" } });
  const r = await handleAccount(request({}), "reauthenticate");
  expect(r.status).toBe(429);
  expect(await r.text()).not.toContain("personal");
});
it("rejects forged identity and redirect fields before composing Auth", async () => {
  expect(
    (
      await handleAccount(
        request({ ...change, userId: id, role: "owner" }),
        "change",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handleAccount(
        request({ ...reset, next: "https://evil.test" }),
        "reset",
      )
    ).status,
  ).toBe(400);
  expect(m.server).not.toHaveBeenCalled();
  expect(m.recovery).not.toHaveBeenCalled();
});
it("validates matching passwords before consuming the link", async () => {
  expect(
    (
      await handleAccount(
        request({ ...reset, confirmation: "different value" }),
        "reset",
      )
    ).status,
  ).toBe(400);
  expect(m.exchange).not.toHaveBeenCalled();
});
it.each([{ origin: "https://evil.test" }, { "sec-fetch-site": "same-site" }])(
  "denies cross-origin/cross-site cookie mutations %#",
  async (headers) => {
    expect((await handleAccount(request(reset, headers), "reset")).status).toBe(
      403,
    );
    expect(m.exchange).not.toHaveBeenCalled();
  },
);
it("bounds the streamed body before Auth calls", async () => {
  expect(
    (
      await handleAccount(
        request({ ...reset, password: "x".repeat(17000) }),
        "reset",
      )
    ).status,
  ).toBe(400);
  expect(m.exchange).not.toHaveBeenCalled();
});
it("cleans up isolated recovery after an update failure", async () => {
  m.update.mockResolvedValue({ error: { code: "same_password" } });
  expect((await handleAccount(request(reset), "reset")).status).toBe(400);
  expect(m.end).toHaveBeenCalledWith({ scope: "local" });
  expect(m.clear).not.toHaveBeenCalled();
});
it.each([false, true])(
  "does not lose saved-password state when logout fails (throws=%s)",
  async (throws) => {
    if (throws) m.end.mockRejectedValue(new Error("provider-private-detail"));
    else m.end.mockResolvedValue({ error: { code: "unexpected_failure" } });
    const response = await handleAccount(request(reset), "reset");
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("se guardó");
    expect(m.revoke).toHaveBeenCalledWith("fake-test-only", "local");
    expect(m.clear).toHaveBeenCalledOnce();
  },
);

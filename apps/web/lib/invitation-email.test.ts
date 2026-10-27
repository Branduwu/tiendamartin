import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sendInvitationEmail } from "./invitation-email";
const token = "a".repeat(64);
const invitation = {
  id: "550e8400-e29b-41d4-a716-446655440020",
  email: "invited@example.invalid",
  role: "cashier" as const,
  locationIds: [],
  expiresAt: "2099-01-01T00:00:00.000Z",
  acceptedAt: null,
  revokedAt: null,
};
const transport = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", transport);
  vi.stubEnv("RESEND_API_KEY", "re_SYNTHETIC_KEY_NO_REAL_ACCESS");
  vi.stubEnv("APP_ORIGIN", "https://smartretail.example.invalid");
  transport.mockResolvedValue(Response.json({ id: "synthetic-message" }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("uses the fixed provider, verified sender, persisted recipient, role and canonical fragment link", async () => {
  expect(await sendInvitationEmail(invitation, token)).toEqual({
    status: "accepted",
  });
  expect(transport).toHaveBeenCalledOnce();
  const [url, options] = transport.mock.calls[0]!;
  expect(url).toBe("https://api.resend.com/emails");
  expect(options?.redirect).toBe("error");
  expect(options?.cache).toBe("no-store");
  expect(options?.signal).toBeInstanceOf(AbortSignal);
  expect(options?.headers).toMatchObject({
    "Idempotency-Key": `invitation/${invitation.id}`,
  });
  const body = JSON.parse(String(options?.body));
  expect(body.from).toBe("SmartRetail <noreply@smartretailapp.live>");
  expect(body.to).toEqual([invitation.email]);
  expect(body.text).toContain("Rol asignado: Cajero.");
  expect(body.text).toContain(
    `https://smartretail.example.invalid/invite#token=${token}`,
  );
  expect(body.text).not.toContain("?token=");
  expect(body.html).toBeUndefined();
  expect(body.text).not.toContain("re_SYNTHETIC");
});
it("keeps the provider idempotency key and payload stable on a repeated send without creation", async () => {
  const accepted = new Map<string, string>();
  transport.mockImplementation(async (_url, init) => {
    const key = new Headers(init?.headers).get("Idempotency-Key")!;
    if (accepted.has(key)) expect(String(init?.body)).toBe(accepted.get(key));
    else accepted.set(key, String(init?.body));
    return Response.json({ id: "same-synthetic-message" });
  });
  await sendInvitationEmail(invitation, token);
  await sendInvitationEmail(invitation, token);
  expect(accepted.size).toBe(1);
});
for (const status of [400, 401, 403, 422, 429])
  it(`reports provider rejection ${status} without returning its body or retrying`, async () => {
    transport.mockResolvedValue(Response.json({ secret: token }, { status }));
    expect(await sendInvitationEmail(invitation, token)).toEqual({
      status: "not_sent",
    });
    expect(transport).toHaveBeenCalledOnce();
  });
for (const status of [408, 409, 500, 503])
  it(`treats provider ${status} as uncertain and never retries automatically`, async () => {
    transport.mockResolvedValue(Response.json({ error: token }, { status }));
    expect(await sendInvitationEmail(invitation, token)).toEqual({
      status: "unknown",
    });
    expect(transport).toHaveBeenCalledOnce();
  });
it("treats transport loss, timeout, malformed or lost success bodies as uncertain", async () => {
  for (const failure of [
    new TypeError("network private detail"),
    new DOMException("private", "TimeoutError"),
  ]) {
    transport.mockRejectedValueOnce(failure);
    expect(await sendInvitationEmail(invitation, token)).toEqual({
      status: "unknown",
    });
  }
  transport.mockResolvedValueOnce(new Response("invalid-json"));
  expect(await sendInvitationEmail(invitation, token)).toEqual({
    status: "unknown",
  });
  transport.mockResolvedValueOnce(Response.json({}));
  expect(await sendInvitationEmail(invitation, token)).toEqual({
    status: "unknown",
  });
});
it("does not send without a configured existing key and a trusted HTTPS origin", async () => {
  for (const origin of [
    "",
    "http://127.0.0.1:3000",
    "https://evil.test/path",
    "https://user:pass@example.invalid",
    "not-a-url",
  ]) {
    vi.stubEnv("APP_ORIGIN", origin);
    expect(await sendInvitationEmail(invitation, token)).toEqual({
      status: "not_sent",
    });
  }
  vi.stubEnv("APP_ORIGIN", "https://smartretail.example.invalid");
  vi.stubEnv("RESEND_API_KEY", "");
  expect(await sendInvitationEmail(invitation, token)).toEqual({
    status: "not_sent",
  });
  expect(transport).not.toHaveBeenCalled();
});
it("never sends revoked, accepted, expired or malformed invitations or tokens", async () => {
  for (const data of [
    { ...invitation, revokedAt: "2026-01-01T00:00:00Z" },
    { ...invitation, acceptedAt: "2026-01-01T00:00:00Z" },
    { ...invitation, expiresAt: "2000-01-01T00:00:00Z" },
    { ...invitation, email: "bad\r\nrecipient" },
    { ...invitation, role: "owner" },
  ])
    expect(await sendInvitationEmail(data as typeof invitation, token)).toEqual(
      { status: "not_sent" },
    );
  expect(await sendInvitationEmail(invitation, "invalid")).toEqual({
    status: "not_sent",
  });
  expect(transport).not.toHaveBeenCalled();
});

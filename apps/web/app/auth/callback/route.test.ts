import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  exchange: vi.fn(),
  claims: vi.fn(),
  revoke: vi.fn(),
  end: vi.fn(),
  set: vi.fn(),
  normal: vi.fn(),
  isolated: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../../lib/supabase/server", () => ({ serverAuth: m.normal }));
vi.mock("../../../lib/supabase/recovery", () => ({ recoveryAuth: m.isolated }));
import { GET } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
  m.isolated.mockResolvedValue({
    auth: {
      exchangeCodeForSession: m.exchange,
      getClaims: m.claims,
      admin: { signOut: m.revoke },
      signOut: m.end,
    },
  });
  m.normal.mockResolvedValue({ auth: { setSession: m.set } });
  m.exchange.mockResolvedValue({
    data: {
      user: { id: "actor" },
      session: {
        access_token: "test-only",
        refresh_token: "test-refresh-only",
      },
    },
    error: null,
  });
  m.claims.mockResolvedValue({
    data: {
      claims: { sub: "actor", session_id: "s", amr: [{ method: "otp" }] },
    },
    error: null,
  });
  m.revoke.mockResolvedValue({ error: null });
  m.end.mockResolvedValue({ error: null });
  m.set.mockResolvedValue({ error: null });
});
it.each(["otp", "email/signup"])(
  "adopts verified %s confirmation and ignores external redirect",
  async (method) => {
    m.claims.mockResolvedValue({
      data: { claims: { sub: "actor", session_id: "s", amr: [{ method }] } },
      error: null,
    });
    const r = await GET(
      new Request(
        "https://example.test/auth/callback?code=opaque&next=https://evil.test&sb_flow_id=valid_flow_01",
      ),
    );
    expect(r.headers.get("location")).toBe("https://example.test/onboarding");
    expect(m.set).toHaveBeenCalledWith({
      access_token: "test-only",
      refresh_token: "test-refresh-only",
    });
    expect(m.revoke).not.toHaveBeenCalled();
  },
);
it("rejects recovery on the alternate callback before persisting a session", async () => {
  m.claims.mockResolvedValue({
    data: {
      claims: { sub: "actor", session_id: "s", amr: [{ method: "recovery" }] },
    },
    error: null,
  });
  const r = await GET(
    new Request("https://example.test/auth/callback?code=opaque"),
  );
  expect(r.headers.get("location")).toBe("https://example.test/reset-password");
  expect(m.set).not.toHaveBeenCalled();
  expect(m.revoke).toHaveBeenCalledWith("test-only", "local");
});
it("rejects a forged signature without adopting its session", async () => {
  m.claims.mockResolvedValue({ data: null, error: { code: "invalid" } });
  const r = await GET(
    new Request("https://example.test/auth/callback?code=opaque"),
  );
  expect(r.headers.get("location")).toContain("confirmation=retry");
  expect(m.set).not.toHaveBeenCalled();
  expect(m.revoke).toHaveBeenCalled();
});
it("sanitizes failed adoption and revokes only the freshly exchanged session", async () => {
  m.set.mockRejectedValue(new Error("private provider detail"));
  const r = await GET(
    new Request("https://example.test/auth/callback?code=opaque"),
  );
  expect(r.headers.get("location")).toBe(
    "https://example.test/login?confirmation=retry",
  );
  expect(m.revoke).toHaveBeenCalledWith("test-only", "local");
  expect(r.headers.get("referrer-policy")).toBe("no-referrer");
});

import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  set: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({
  authConfiguration: () => ({
    url: "https://synthetic.supabase.co",
    key: "sb_publishable_SYNTHETIC_ONLY",
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: unknown) => {
      state.set(name, value, options);
      if (value) state.jar.set(name, value);
      else state.jar.delete(name);
    },
  }),
}));
import { serverAuth, serverClaims } from "./server";
beforeEach(() => {
  vi.useFakeTimers();
  state.jar.clear();
  state.set.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const encoded =
    "base64-" +
    Buffer.from(
      JSON.stringify({
        access_token: "SYNTHETIC_ACCESS",
        refresh_token: "SYNTHETIC_REFRESH",
        expires_at: Math.floor(Date.now() / 1000) - 60,
        user: { id: "synthetic-user" },
        token_type: "bearer",
      }),
    ).toString("base64url");
  state.jar.set("sb-synthetic-auth-token.0", encoded.slice(0, 100));
  state.jar.set("sb-synthetic-auth-token.1", encoded.slice(100));
  state.jar.set("unrelated", "PRESERVE");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("real SSR SDK expires only this terminal session cookie and all fragments", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          code: "refresh_token_not_found",
          message: "SYNTHETIC_ONLY",
        }),
        {
          status: 400,
          headers: {
            "content-type": "application/json",
            "x-supabase-api-version": "2024-01-01",
          },
        },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const client = await serverAuth();
  expect(client).not.toBeNull();
  const result = await serverClaims(client!);
  expect(result.error).not.toBeNull();
  expect(state.jar.has("sb-synthetic-auth-token.0")).toBe(false);
  expect(state.jar.has("sb-synthetic-auth-token.1")).toBe(false);
  expect(state.jar.get("unrelated")).toBe("PRESERVE");
  expect(fetcher).toHaveBeenCalledTimes(1);
  for (const [, value, options] of state.set.mock.calls) {
    expect(value).toBe("");
    expect(options.maxAge).toBe(0);
  }
  const next = await serverAuth();
  await serverClaims(next!);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("real SSR SDK does not expire session fragments during a temporary outage", async () => {
  const initial = [...state.jar];
  const fetcher = vi.fn(async () => new Response("{}", { status: 502 }));
  vi.stubGlobal("fetch", fetcher);
  const client = await serverAuth();
  const observed = serverClaims(client!).catch((error) => error);
  await vi.advanceTimersByTimeAsync(5000);
  expect((await observed).name).toBe("TimeoutError");
  const attempts = fetcher.mock.calls.length;
  expect(attempts).toBeGreaterThan(0);
  expect(attempts).toBeLessThanOrEqual(5);
  await vi.advanceTimersByTimeAsync(30000);
  expect([...state.jar]).toEqual(initial);
  expect(state.set).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(attempts);
});

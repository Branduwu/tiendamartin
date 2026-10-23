import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { authFailure, authTransport, authRead, authTiming } from "./resilience";
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it.each([
  [{ code: "invalid_credentials" }, "credentials"],
  [{ code: "refresh_token_not_found" }, "session"],
  [{ status: 502 }, "unavailable"],
  [{ status: 540 }, "unavailable"],
  [{ status: 429 }, "rate_limit"],
  [new TypeError("SENSITIVE_SENTINEL"), "unavailable"],
  [{ name: "TimeoutError" }, "timeout"],
  [{ code: "OTHER", message: "SENSITIVE_SENTINEL" }, "unknown"],
  [null, "unknown"],
])("classifies only finite auth categories: %j", (error, kind) =>
  expect(authFailure(error)).toBe(kind),
);
it("aborts a pending fetch and finishes within its deadline", async () => {
  let signal: AbortSignal | null | undefined;
  const fetcher = vi.fn(async (_input, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => {});
  }) as unknown as typeof fetch;
  const transport = authTransport(fetcher, 100);
  const observed = transport
    .fetch("https://synthetic.invalid/auth/v1/token?grant_type=password", {
      method: "POST",
    })
    .catch((e) => e);
  await vi.advanceTimersByTimeAsync(100);
  expect(authFailure(await observed)).toBe("timeout");
  expect(signal?.aborted).toBe(true);
});
it("includes a stalled response body in the deadline", async () => {
  const body = new ReadableStream<Uint8Array>({ start() {} });
  const transport = authTransport(
    vi.fn(async () => new Response(body)) as unknown as typeof fetch,
    100,
  );
  const observed = transport
    .fetch("https://synthetic.invalid/auth/v1/user")
    .catch((e) => e);
  await vi.advanceTimersByTimeAsync(100);
  expect(authFailure(await observed)).toBe("timeout");
});
it("preserves caller cancellation and does not send already cancelled requests", async () => {
  const fetcher = vi.fn(
    async () => new Promise<Response>(() => {}),
  ) as unknown as typeof fetch;
  const transport = authTransport(fetcher, 1000);
  const controller = new AbortController();
  const pending = transport
    .fetch("https://synthetic.invalid/auth/v1/user", {
      signal: controller.signal,
    })
    .catch((e) => e);
  controller.abort();
  await pending;
  expect(vi.mocked(fetcher).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await expect(
    transport.fetch("https://synthetic.invalid/auth/v1/user", {
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("transport does not share a refresh cooldown or retry password POSTs", async () => {
  const fetcher = vi.fn(async () => new Response("{}", { status: 502 }));
  const transport = authTransport(fetcher, 1000);
  const url =
    "https://synthetic.invalid/auth/v1/token?grant_type=refresh_token";
  await expect(transport.fetch(url, { method: "POST" })).rejects.toThrow(
    "AUTH_TEMPORARILY_UNAVAILABLE",
  );
  // Backoff belongs to the SDK, not to an unkeyed transport cache.
  expect(fetcher).toHaveBeenCalledTimes(1);
  await transport.fetch(
    "https://synthetic.invalid/auth/v1/token?grant_type=password",
    { method: "POST" },
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockResolvedValue(new Response("{}", { status: 200 }));
  expect((await transport.fetch(url, { method: "POST" })).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("does not reinterpret terminal refresh errors or clear storage itself", async () => {
  const transport = authTransport(
    vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "refresh_token_not_found" }), {
          status: 400,
        }),
    ),
  );
  const response = await transport.fetch(
    "https://synthetic.invalid/auth/v1/token?grant_type=refresh_token",
    { method: "POST" },
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    code: "refresh_token_not_found",
    message: "AUTH_REFRESH_REJECTED",
    msg: "AUTH_REFRESH_REJECTED",
  });
});
it("read budget closes transport and future SDK backoff cannot send network requests", async () => {
  const fetcher = vi.fn(
    async () => new Promise<Response>(() => {}),
  ) as unknown as typeof fetch;
  const transport = authTransport(fetcher, 8000);
  const result = authRead(
    () => transport.fetch("https://synthetic.invalid/auth/v1/user"),
    () => transport.close(),
    100,
  ).catch((e) => e);
  await vi.advanceTimersByTimeAsync(100);
  expect(authFailure(await result)).toBe("timeout");
  await expect(
    transport.fetch("https://synthetic.invalid/auth/v1/user"),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("telemetry cannot include provider messages, credentials or tokens", () => {
  const value = authTiming(
    "login",
    performance.now(),
    authFailure({ status: 502, message: "PRIVATE_SENTINEL" }),
  );
  expect(Object.keys(value).sort()).toEqual(["durationMs", "outcome", "stage"]);
  expect(JSON.stringify(value)).not.toContain("PRIVATE_SENTINEL");
});
function sdkFixture(
  status: number,
  code: string,
  rawBody?: string,
  expiresAt = Math.floor(Date.now() / 1000) - 60,
) {
  const store = new Map<string, string>([
    ["unrelated", "DO_NOT_REMOVE"],
    [
      "auth-test",
      JSON.stringify({
        access_token: "SYNTHETIC_ACCESS",
        refresh_token: "SYNTHETIC_REFRESH",
        expires_at: expiresAt,
        token_type: "bearer",
        user: { id: "synthetic-user" },
      }),
    ],
  ]);
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        rawBody ?? JSON.stringify({ code, message: "SYNTHETIC_ONLY" }),
        {
          status,
          headers: {
            "content-type": "application/json",
            "x-supabase-api-version": "2024-01-01",
          },
        },
      ),
  );
  const transport = authTransport(fetcher, 100);
  const client = createClient("https://synthetic.invalid", "SYNTHETIC_PUBLIC", {
    global: { fetch: transport.fetch },
    auth: {
      storageKey: "auth-test",
      persistSession: true,
      detectSessionInUrl: false,
      autoRefreshToken: false,
      storage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => {
          store.set(key, value);
        },
        removeItem: (key) => {
          store.delete(key);
        },
      },
    },
  });
  return { client, store, fetcher, transport };
}
it("native SDK removes only the terminal expired synthetic session, no global logout", async () => {
  const { client, store, fetcher } = sdkFixture(400, "refresh_token_not_found");
  await client.auth.getSession();
  expect(store.has("auth-test")).toBe(false);
  expect(store.get("unrelated")).toBe("DO_NOT_REMOVE");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await client.auth.getSession();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("refresh errors preserve allowed codes but never forward provider text or fields to the SDK", async () => {
  const transport = authTransport(
    async () =>
      new Response(
        JSON.stringify({
          code: "refresh_token_not_found",
          message: "PRIVATE_REFRESH_CANARY",
          msg: "PRIVATE_REFRESH_CANARY",
          access_token: "PRIVATE_REFRESH_CANARY",
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
  const response = await transport.fetch(
    "https://synthetic.invalid/auth/v1/token?grant_type=refresh_token",
    { method: "POST" },
  );
  const body = await response.json();
  expect(response.status).toBe(400);
  expect(body.code).toBe("refresh_token_not_found");
  expect(JSON.stringify(body)).not.toContain("PRIVATE_REFRESH_CANARY");
  expect(Object.keys(body).sort()).toEqual(["code", "message", "msg"]);
});
it("an unrecognized refresh code cannot enter SDK logs", async () => {
  const transport = authTransport(
    async () =>
      new Response(
        JSON.stringify({
          code: "PRIVATE_REFRESH_CANARY",
          message: "PRIVATE_REFRESH_CANARY",
        }),
        { status: 400 },
      ),
  );
  const response = await transport.fetch(
    "https://synthetic.invalid/auth/v1/token?grant_type=refresh_token",
    { method: "POST" },
  );
  expect(await response.text()).not.toContain("PRIVATE_REFRESH_CANARY");
});
it("malformed refresh responses preserve expired storage rather than fabricating a terminal rejection", async () => {
  const fixture = sdkFixture(400, "unused", "not JSON");
  const observed = fixture.client.auth.getSession();
  await vi.advanceTimersByTimeAsync(35000);
  const result = await observed;
  expect(result.error).not.toBeNull();
  expect(result.data.session).toBeNull();
  expect(fixture.store.has("auth-test")).toBe(true);
  const attempts = fixture.fetcher.mock.calls.length;
  expect(attempts).toBeGreaterThan(0);
  expect(attempts).toBeLessThan(10);
  await fixture.client.auth.getSession();
  expect(fixture.fetcher).toHaveBeenCalledTimes(attempts);
});
it.each([502, 540, 429])(
  "native SDK preserves expired storage on transient %i without granting access",
  async (status) => {
    const { client, store, fetcher } = sdkFixture(status, "SYNTHETIC_OUTAGE");
    const observed = client.auth.getSession();
    await vi.advanceTimersByTimeAsync(35000);
    const result = await observed;
    expect(result.error).not.toBeNull();
    expect(result.data.session).toBeNull();
    expect(store.has("auth-test")).toBe(true);
    expect(store.get("unrelated")).toBe("DO_NOT_REMOVE");
    const attempts = fetcher.mock.calls.length;
    expect(attempts).toBeGreaterThan(0);
    expect(attempts).toBeLessThan(10);
    await client.auth.getSession();
    expect(fetcher).toHaveBeenCalledTimes(attempts);
  },
);

it("SDK failure cache isolates the old refresh token from a new session", async () => {
  const { client, fetcher, store } = sdkFixture(502, "SYNTHETIC_OUTAGE");
  const startedAt = Date.now();
  const old = client.auth.getSession();
  await vi.advanceTimersByTimeAsync(26000);
  expect((await old).data.session).toBeNull();
  const attempts = fetcher.mock.calls.length;
  await client.auth.getSession();
  expect(fetcher).toHaveBeenCalledTimes(attempts);
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        access_token: "SYNTHETIC_NEW_ACCESS",
        refresh_token: "SYNTHETIC_NEW_REFRESH",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "synthetic-user" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  expect(Date.now() - startedAt).toBeLessThan(30000);
  const refreshing = client.auth.refreshSession({
    refresh_token: "SYNTHETIC_NEW_REFRESH",
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(attempts + 1);
  const fresh = await refreshing;
  expect(fresh.error).toBeNull();
  expect(fresh.data.session).not.toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(attempts + 1);
  expect(store.get("unrelated")).toBe("DO_NOT_REMOVE");
});

it.each(["logout", "password"] as const)(
  "native SDK waits for a delayed %s result without local timeout or retry",
  async (operation) => {
    const { client, fetcher, store } = sdkFixture(
      200,
      "unused",
      undefined,
      Math.floor(Date.now() / 1000) + 3600,
    );
    await client.auth.getSession();
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(
            () =>
              resolve(
                operation === "logout"
                  ? new Response(null, { status: 204 })
                  : new Response(JSON.stringify({ id: "synthetic-user" })),
              ),
            9000,
          );
        }),
    );
    let settled = false;
    const pending =
      operation === "logout"
        ? client.auth.signOut()
        : client.auth.updateUser({ password: "SYNTHETIC_PASSWORD_ONLY" });
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(8001);
    expect(settled).toBe(false);
    expect(store.has("auth-test")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect((await pending).error).toBeNull();
    expect(store.has("auth-test")).toBe(operation !== "logout");
    expect(store.get("unrelated")).toBe("DO_NOT_REMOVE");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain(operation === "logout" ? "/logout" : "/user");
    expect(options?.method).toBe(operation === "logout" ? "POST" : "PUT");
    expect(options?.signal).toBeUndefined();
  },
);

it("mutation transport preserves caller cancellation without retry or a read deadline", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(async (_url, init) => {
    expect(_url).toBeInstanceOf(Request);
    expect((_url as Request).signal.aborted).toBe(false);
    expect(init).toBeUndefined();
    throw new TypeError("SYNTHETIC_NETWORK_DISCONNECT");
  }) as unknown as typeof fetch;
  const transport = authTransport(fetcher, 100);
  await expect(
    transport.fetch(
      new Request("https://synthetic.invalid/auth/v1/user", {
        method: "PUT",
        signal: controller.signal,
      }),
    ),
  ).rejects.toThrow("SYNTHETIC_NETWORK_DISCONNECT");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

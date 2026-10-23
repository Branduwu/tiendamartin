import { beforeEach, afterEach, vi, it, expect } from "vitest";
import { loginAttempt } from "./login-attempt";
const credentials = {
  email: "synthetic@example.invalid",
  password: "PRIVATE_CANARY",
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("success is one request and further submissions are ignored", async () => {
  const call = vi.fn(async () => ({ error: null }));
  const flow = loginAttempt(call, vi.fn());
  expect(await flow.run(credentials)).toEqual({ kind: "success" });
  expect(flow.authenticated).toBe(true);
  expect(await flow.run(credentials)).toEqual({ kind: "ignored" });
  expect(call).toHaveBeenCalledTimes(1);
});
it.each([
  { status: 502 },
  { code: "invalid_credentials" },
  { code: "refresh_token_not_found" },
  new TypeError("PRIVATE_CANARY"),
])("does not retry an unsuccessful password request: %j", async (error) => {
  const call = vi.fn(async () => ({ error }));
  const flow = loginAttempt(call, vi.fn());
  expect((await flow.run(credentials)).kind).toBe("error");
  expect(flow.pending).toBe(false);
  expect(call).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
    "PRIVATE_CANARY",
  );
});
it("synchronous duplicate submissions and timed-out pending operations cannot overlap", async () => {
  let finish!: (value: { error: null }) => void;
  const call = vi.fn(
    () =>
      new Promise<{ error: null }>((resolve) => {
        finish = resolve;
      }),
  );
  const late = vi.fn();
  const flow = loginAttempt(call, late, 100);
  const first = flow.run(credentials);
  expect(await flow.run(credentials)).toEqual({ kind: "ignored" });
  await vi.advanceTimersByTimeAsync(100);
  expect(await first).toEqual({ kind: "error", failure: "timeout" });
  expect(flow.pending).toBe(true);
  expect(await flow.run(credentials)).toEqual({ kind: "ignored" });
  finish({ error: null });
  await vi.advanceTimersByTimeAsync(0);
  expect(late).toHaveBeenCalledWith({ kind: "success" });
  expect(call).toHaveBeenCalledTimes(1);
});
it("recovers by an explicit new submission after a settled failure", async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce({ error: { status: 502 } })
    .mockResolvedValueOnce({ error: null });
  const flow = loginAttempt(call, vi.fn());
  expect((await flow.run(credentials)).kind).toBe("error");
  expect((await flow.run(credentials)).kind).toBe("success");
  expect(call).toHaveBeenCalledTimes(2);
});

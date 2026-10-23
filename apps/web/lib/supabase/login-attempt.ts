import {
  authFailure,
  authTiming,
  LOGIN_TIMEOUT_MS,
  type AuthFailure,
} from "./resilience";
type Result =
  | { kind: "success" }
  | { kind: "error"; failure: AuthFailure }
  | { kind: "ignored" };
type Credentials = { email: string; password: string };
/** One SDK call at a time. A UI timeout does not permit a second in-flight POST. */
export function loginAttempt(
  signIn: (credentials: Credentials) => Promise<{ error: unknown }>,
  late: (result: Result) => void,
  timeoutMs = LOGIN_TIMEOUT_MS,
) {
  let pending = false;
  let authenticated = false;
  return {
    get pending() {
      return pending;
    },
    get authenticated() {
      return authenticated;
    },
    async run(credentials: Credentials): Promise<Result> {
      if (pending || authenticated) return { kind: "ignored" };
      pending = true;
      const start = performance.now();
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const request = Promise.resolve()
        .then(() => signIn(credentials))
        .then(
          ({ error }): Result =>
            error
              ? { kind: "error", failure: authFailure(error) }
              : { kind: "success" },
          (error): Result => ({ kind: "error", failure: authFailure(error) }),
        )
        .then((result) => {
          pending = false;
          if (result.kind === "success") authenticated = true;
          if (expired) late(result); // status only: caller must not navigate automatically.
          return result;
        });
      try {
        const result = await Promise.race([
          request,
          new Promise<Result>((resolve) => {
            timer = setTimeout(() => {
              expired = true;
              resolve({ kind: "error", failure: "timeout" });
            }, timeoutMs);
          }),
        ]);
        console.info(
          "AUTH_OPERATION",
          authTiming(
            "login",
            start,
            result.kind === "error"
              ? result.failure
              : result.kind === "success"
                ? "success"
                : "unknown",
          ),
        );
        return result;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Auth transport: never parse or log headers, bodies or token values. */
export const AUTH_FETCH_TIMEOUT_MS = 8_000;
export const AUTH_READ_TIMEOUT_MS = 5_000;
export const LOGIN_TIMEOUT_MS = 12_000;
export type AuthFailure =
  | "credentials"
  | "session"
  | "unavailable"
  | "timeout"
  | "rate_limit"
  | "unknown";
export function authFailure(error: unknown): AuthFailure {
  if (!error || typeof error !== "object") return "unknown";
  const e = error as {
    code?: unknown;
    status?: unknown;
    name?: unknown;
    message?: unknown;
  };
  if (e.name === "TimeoutError" || e.message === "AUTH_REQUEST_TIMEOUT")
    return "timeout";
  if (e.status === 429) return "rate_limit";
  if (typeof e.status === "number" && e.status >= 500) return "unavailable";
  if (
    e.code === "refresh_token_not_found" ||
    e.code === "refresh_token_already_used"
  )
    return "session";
  if (e.code === "invalid_credentials") return "credentials";
  if (
    e.name === "AuthRetryableFetchError" ||
    e.name === "TypeError" ||
    e.name === "AbortError"
  )
    return "unavailable";
  return "unknown";
}
export const AUTH_MESSAGES: Record<AuthFailure, string> = {
  credentials: "No pudimos iniciar sesión. Revisa tu correo y contraseña.",
  session: "Tu sesión anterior ya no se puede renovar. Inicia sesión de nuevo.",
  unavailable:
    "El servicio de acceso no está disponible temporalmente. Inténtalo más tarde; no necesitas cambiar tu contraseña.",
  timeout:
    "El servicio de acceso está tardando demasiado. Espera antes de intentarlo de nuevo.",
  rate_limit:
    "Se alcanzó el límite de intentos. Espera antes de volver a intentarlo.",
  unknown:
    "No pudimos completar el acceso. Inténtalo más tarde o contacta al administrador.",
};
function timeoutError() {
  const error = new TypeError("AUTH_REQUEST_TIMEOUT");
  error.name = "TimeoutError";
  return error;
}
/** The SDK can console.error refresh failures during session restoration. */
function privateRefreshError(body: ArrayBuffer) {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    // A malformed response is not evidence that the session is terminal.
    throw new TypeError("AUTH_TEMPORARILY_UNAVAILABLE");
  }
  if (!value || typeof value !== "object")
    throw new TypeError("AUTH_TEMPORARILY_UNAVAILABLE");
  const code = "code" in value ? value.code : undefined;
  const allowed = new Set([
    "refresh_token_not_found",
    "refresh_token_already_used",
    "session_not_found",
    "session_expired",
    "user_banned",
    "user_not_found",
    "bad_jwt",
  ]);
  return JSON.stringify({
    ...(typeof code === "string" && allowed.has(code) ? { code } : {}),
    message: "AUTH_REFRESH_REJECTED",
    msg: "AUTH_REFRESH_REJECTED",
  });
}
/** Finite records only; no provider messages, URLs, actor or session identifiers. */
export function authTiming(
  stage: "login" | "claims",
  start: number,
  outcome: AuthFailure | "success",
) {
  return {
    stage,
    durationMs: Math.max(0, Math.round(performance.now() - start)),
    outcome,
  };
}
export function authTransport(
  fetcher: typeof fetch = fetch,
  timeoutMs = AUTH_FETCH_TIMEOUT_MS,
) {
  let closed = false;
  const active = new Set<AbortController>();
  return {
    close() {
      closed = true;
      for (const controller of active)
        controller.abort(new TypeError("AUTH_REQUEST_CANCELLED"));
    },
    fetch: (async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const refresh =
        url.pathname.endsWith("/auth/v1/token") &&
        url.searchParams.get("grant_type") === "refresh_token";
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      // Mutation outcomes must come from the provider, not a local read deadline.
      // In particular, never abort/retry logout or password changes after 8s.
      const bounded =
        (method === "POST" &&
          url.pathname.endsWith("/auth/v1/token") &&
          ["password", "refresh_token"].includes(
            url.searchParams.get("grant_type") ?? "",
          )) ||
        (method === "GET" &&
          (url.pathname.endsWith("/auth/v1/user") ||
            url.pathname.endsWith("/auth/v1/.well-known/jwks.json")));
      if (!bounded) return fetcher(input, init);
      if (closed) throw new TypeError("AUTH_TEMPORARILY_UNAVAILABLE");
      const controller = new AbortController();
      const upstream =
        init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (upstream?.aborted) throw new TypeError("AUTH_REQUEST_CANCELLED");
      const abort = () =>
        controller.abort(new TypeError("AUTH_REQUEST_CANCELLED"));
      active.add(controller);
      upstream?.addEventListener("abort", abort, { once: true });
      if (upstream?.aborted)
        controller.abort(new TypeError("AUTH_REQUEST_CANCELLED"));
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectAborted: (() => void) | undefined;
      try {
        const response = await Promise.race([
          (async () => {
            const response = await fetcher(input, {
              ...init,
              signal: controller.signal,
            });
            // Include the response body in the deadline, not just headers.
            const body = await response.arrayBuffer();
            const safeBody =
              refresh &&
              response.status >= 400 &&
              response.status < 500 &&
              response.status !== 429
                ? privateRefreshError(body)
                : body;
            return new Response(
              [204, 205, 304].includes(response.status) ? null : safeBody,
              {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              },
            );
          })(),
          new Promise<never>((_, reject) => {
            rejectAborted = () => reject(controller.signal.reason);
            controller.signal.addEventListener("abort", rejectAborted, {
              once: true,
            });
            if (controller.signal.aborted) rejectAborted();
            timer = setTimeout(() => {
              controller.abort(timeoutError());
            }, timeoutMs);
          }),
        ]);
        if (refresh && (response.status === 429 || response.status >= 500)) {
          // The SDK owns token-scoped backoff and failure caching. Do not keep
          // a transport-wide cooldown that could block a different session.
          // Including 540: keep transient failures retryable to the SDK so it
          // does not remove an expired session merely because the provider is down.
          throw new TypeError("AUTH_TEMPORARILY_UNAVAILABLE");
        }
        return response;
      } catch (error) {
        throw error instanceof Error && error.message === "AUTH_REQUEST_TIMEOUT"
          ? error
          : new TypeError("AUTH_TEMPORARILY_UNAVAILABLE");
      } finally {
        clearTimeout(timer);
        active.delete(controller);
        upstream?.removeEventListener("abort", abort);
        if (rejectAborted)
          controller.signal.removeEventListener("abort", rejectAborted);
      }
    }) as typeof fetch,
  };
}
/** Bounds SDK refresh/backoff waiting; aborts this request's transport on expiry. */
export async function authRead<T>(
  read: () => Promise<T>,
  cancel: () => void,
  timeoutMs = AUTH_READ_TIMEOUT_MS,
): Promise<T> {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          cancel();
          reject(timeoutError());
        }, timeoutMs);
      }),
    ]);
    const error =
      result && typeof result === "object" && "error" in result
        ? result.error
        : null;
    console.info(
      "AUTH_OPERATION",
      authTiming("claims", start, error ? authFailure(error) : "success"),
    );
    return result;
  } catch (error) {
    console.info(
      "AUTH_OPERATION",
      authTiming("claims", start, authFailure(error)),
    );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

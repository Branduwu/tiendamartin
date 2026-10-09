/** Public deployment URL supplied through server configuration, never request headers. */
export function appOrigin(): URL | undefined {
  const value = process.env.APP_ORIGIN;
  if (!value) return undefined;
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "APP_ORIGIN must be an HTTPS origin (HTTP only for loopback).",
    );
  return url;
}

/** Legacy page navigation only; old callbacks retain their own PKCE cookies. */
export function canonicalPageRedirect(
  request: Request,
  authenticated = false,
): URL | undefined {
  const source = new URL(request.url);
  if (
    authenticated ||
    source.hostname !== "smartretail-sepia.vercel.app" ||
    !["GET", "HEAD"].includes(request.method) ||
    /^\/(api|auth|_next)(\/|$)/.test(source.pathname)
  )
    return undefined;
  const target = appOrigin();
  if (!target || target.origin === source.origin) return undefined;
  target.pathname = source.pathname;
  target.search = source.search;
  return target;
}

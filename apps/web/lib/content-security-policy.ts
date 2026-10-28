import { createHash, randomBytes } from "node:crypto";
import { THEME_BOOTSTRAP } from "./theme";

const themeHash = createHash("sha256").update(THEME_BOOTSTRAP).digest("base64");

/** No user input or request origin becomes a trusted resource origin. */
export function contentSecurityPolicy({
  nonce,
  authUrl,
  development = false,
  https = true,
}: {
  nonce: string;
  authUrl?: string | undefined;
  development?: boolean;
  https?: boolean;
}) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(nonce))
    throw new TypeError("Invalid CSP nonce");
  let authOrigin = "";
  if (authUrl) {
    const url = new URL(authUrl);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new TypeError("Invalid Auth origin");
    authOrigin = url.origin;
  }
  return [
    "default-src 'self'",
    // Only the fixed theme code recreated by next/script needs a hash.
    // WASM compilation is needed by the existing scanner; JS eval stays denied.
    `script-src 'self' 'nonce-${nonce}' 'sha256-${themeHash}' 'wasm-unsafe-eval'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self'${authOrigin ? " " + authOrigin : ""}${development ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function pageSecurityPolicy(
  path: string,
  authUrl?: string,
  https = true,
) {
  if (!nonceDocumentPath(path)) return null;
  const nonce = randomBytes(32).toString("base64");
  return {
    nonce,
    value: contentSecurityPolicy({
      nonce,
      authUrl,
      https,
      development: process.env.NODE_ENV === "development",
    }),
    // Local staging can observe violations without an external reporting service.
    header:
      process.env.CSP_REPORT_ONLY === "true" &&
      !process.env.VERCEL &&
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
        process.env.APP_ORIGIN ?? "",
      )
        ? "Content-Security-Policy-Report-Only"
        : "Content-Security-Policy",
  };
}

// Unknown URLs can return a prerendered error document. Never attach a fresh
// nonce to cached HTML whose inline scripts cannot contain that nonce.
export function nonceDocumentPath(path: string) {
  return /^(?:\/|\/(?:login|register|forgot-password|reset-password|onboarding|invite|dashboard|products|inventory(?:\/alerts)?|pos|cash|promotions|expenses|labels)|\/(?:customers|suppliers|sales|purchases|receivables|payables)(?:\/[^/]+)?|\/settings\/(?:account|business|taxes|users)|\/platform(?:\/companies(?:\/[^/]+)?|\/support)?|\/help(?:\/[^/]+)?)$/.test(
    path,
  );
}

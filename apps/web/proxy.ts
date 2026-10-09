import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { UuidSchema } from "@smartretail/contracts";
import { SUSPENDED_COMPANY_MESSAGE } from "@smartretail/application";
import { platformForUser, tenantsForUser } from "./lib/database";
import { authConfiguration } from "./lib/supabase/config";
import { canonicalPageRedirect } from "./lib/app-origin";

export async function proxy(request: NextRequest) {
  let authenticated = false;
  let response = NextResponse.next({ request });
  const config = authConfiguration();
  if (config) {
    const client = createServerClient(config.url, config.key, {
      cookieOptions: {
        secure: request.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/",
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    try {
      const { data, error } = await client.auth.getClaims();
      const actor = UuidSchema.safeParse(data?.claims.sub),
        tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
      authenticated = !error && actor.success;
      const operationalPage =
        /^\/(products|inventory|pos|cash|sales|customers|suppliers|purchases|promotions|dashboard|labels|receivables|payables|expenses|settings)(\/|$)/.test(
          request.nextUrl.pathname,
        );
      if (
        !error &&
        actor.success &&
        operationalPage &&
        request.nextUrl.pathname !== "/settings/account" &&
        (await tenantsForUser(actor.data)).length === 0
      ) {
        const handoff = NextResponse.redirect(
          new URL("/onboarding", request.url),
        );
        response.cookies.getAll().forEach((c) => handoff.cookies.set(c));
        handoff.headers.set("Cache-Control", "private, no-store");
        return handoff;
      }
      if (
        !error &&
        actor.success &&
        tenant.success &&
        request.nextUrl.pathname.startsWith("/api/v1/") &&
        !request.nextUrl.pathname.startsWith("/api/v1/platform") &&
        request.nextUrl.pathname !== "/api/v1/tenants"
      ) {
        if (
          (await platformForUser(actor.data).tenantStatus(tenant.data)) ===
          "suspended"
        ) {
          const denied = NextResponse.json(
            { error: SUSPENDED_COMPANY_MESSAGE },
            { status: 403, headers: { "Cache-Control": "private, no-store" } },
          );
          response.cookies.getAll().forEach((c) => denied.cookies.set(c));
          return denied;
        }
      }
    } catch {
      /* Each protected handler verifies again and denies access. */
    }
  }
  const canonical = canonicalPageRedirect(request, authenticated);
  if (canonical)
    return NextResponse.redirect(canonical, {
      status: 307,
      headers: { "Cache-Control": "private, no-store" },
    });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/onboarding",
    "/invite",
    "/customers/:path*",
    "/suppliers/:path*",
    "/purchases/:path*",
    "/promotions/:path*",
    "/dashboard/:path*",
    "/labels/:path*",
    "/receivables/:path*",
    "/payables/:path*",
    "/expenses/:path*",
    "/settings/:path*",
    "/platform/:path*",
    "/help/:path*",
    "/api/v1/:path*",
    "/products/:path*",
    "/inventory/:path*",
    "/pos/:path*",
    "/cash/:path*",
    "/sales/:path*",
    "/api/v1/locations",
    "/api/v1/inventory/:path*",
    "/api/v1/tenants",
    "/api/v1/products/:path*",
    "/api/v1/cash/:path*",
    "/api/v1/sales/:path*",
    "/api/v1/suspended-sales/:path*",
  ],
};

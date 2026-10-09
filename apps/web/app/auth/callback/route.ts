import { NextResponse } from "next/server";
import { serverAuth } from "../../../lib/supabase/server";
import { recoveryAuth } from "../../../lib/supabase/recovery";

function redirect(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url), {
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code"),
    flowId = params.get("sb_flow_id");
  let isolated: Awaited<ReturnType<typeof recoveryAuth>> = null;
  let exchanged = false,
    adopted = false;
  let exchangedToken = "";
  try {
    if (
      !code ||
      code.length > 4096 ||
      (flowId && !/^[a-zA-Z0-9_-]{8,64}$/.test(flowId))
    )
      return redirect(request, "/login?confirmation=retry");
    isolated = await recoveryAuth();
    if (!isolated) return redirect(request, "/login?confirmation=retry");
    const { data, error } = await isolated.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );
    if (error || !data.session)
      return redirect(request, "/login?confirmation=retry");
    exchanged = true;
    exchangedToken = data.session.access_token;
    const verified = await isolated.auth.getClaims(data.session.access_token);
    const claims = verified.data?.claims;
    if (
      verified.error ||
      claims?.sub !== data.user.id ||
      !claims?.session_id ||
      !claims.amr?.length
    )
      return redirect(request, "/login?confirmation=retry");
    // A recovery code cannot be repurposed into an ordinary logged-in session.
    if (
      claims.amr.some(
        (entry) => typeof entry === "object" && entry.method === "recovery",
      )
    )
      return redirect(request, "/reset-password");
    if (
      !claims.amr.some(
        (entry) =>
          typeof entry === "object" &&
          ["otp", "magiclink", "email/signup"].includes(entry.method),
      )
    )
      return redirect(request, "/login?confirmation=retry");
    const normal = await serverAuth();
    if (!normal) return redirect(request, "/login?confirmation=retry");
    const result = await normal.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (result.error) return redirect(request, "/login?confirmation=retry");
    adopted = true;
    return redirect(request, "/onboarding");
  } catch {
    return redirect(request, "/login?confirmation=retry");
  } finally {
    if (exchanged && !adopted && isolated) {
      try {
        if ((await isolated.auth.admin.signOut(exchangedToken, "local")).error)
          console.warn("auth_callback_revocation_failed");
        if ((await isolated.auth.signOut({ scope: "local" })).error)
          console.warn("auth_callback_cleanup_failed");
      } catch {
        console.warn("auth_callback_cleanup_failed");
      }
    }
    exchangedToken = "";
  }
}

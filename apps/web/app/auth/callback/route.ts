import { NextResponse } from "next/server";
import { serverAuth } from "../../../lib/supabase/server";
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code"),
    client = await serverAuth();
  if (code && code.length <= 4096 && client) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(new URL("/onboarding", request.url), {
        headers: {
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
  }
  return NextResponse.redirect(
    new URL("/login?confirmation=retry", request.url),
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

"use client";
import { createBrowserClient } from "@supabase/ssr";
import { authConfiguration } from "./config";
import { authTransport } from "./resilience";

export function browserAuth() {
  const config = authConfiguration();
  if (!config) throw new Error("El inicio de sesión no está configurado.");
  return createBrowserClient(config.url, config.key, {
    global: { fetch: authTransport().fetch },
    cookieOptions: {
      secure: window.location.protocol === "https:",
      sameSite: "lax",
      path: "/",
    },
  });
}

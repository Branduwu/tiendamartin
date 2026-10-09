"use client";
import { createBrowserClient } from "@supabase/ssr";
import { authConfiguration } from "./config";

export function browserAuth() {
  const config = authConfiguration();
  if (!config) throw new Error("El inicio de sesión no está configurado.");
  return createBrowserClient(config.url, config.key, {
    cookieOptions: {
      secure: window.location.protocol === "https:",
      sameSite: "lax",
      path: "/",
    },
  });
}

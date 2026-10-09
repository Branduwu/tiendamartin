import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { authConfiguration } from "./config";

/** Isolated PKCE exchange: never emit recovery access/refresh tokens to the browser. */
export async function recoveryAuth() {
  const config = authConfiguration();
  if (!config) return null;
  const store = await cookies();
  const verifier = (name: string) => /-code-verifier(?:\.\d+)?$/.test(name);
  const jar = new Map(
    store
      .getAll()
      .filter((c) => verifier(c.name))
      .map((c) => [c.name, c.value]),
  );
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll(values) {
        for (const { name, value, options } of values) {
          jar.set(name, value);
          if (verifier(name) && value === "") store.set(name, "", options);
        }
      },
    },
  });
}

/** Clear this browser's old context after a successful reset; never revoke another actor. */
export async function clearAuthCookies() {
  const config = authConfiguration();
  if (!config) return;
  const store = await cookies();
  const prefix = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
  for (const cookie of store.getAll()) {
    if (cookie.name === prefix || cookie.name.startsWith(prefix + "."))
      store.set(cookie.name, "", {
        path: "/",
        maxAge: 0,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });
  }
}

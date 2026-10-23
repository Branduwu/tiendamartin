import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { authConfiguration } from "./config";
import { authRead, authTransport } from "./resilience";

const transports = new WeakMap<object, ReturnType<typeof authTransport>>();
export function serverClaims(
  client: NonNullable<Awaited<ReturnType<typeof serverAuth>>>,
) {
  return authRead(
    () => client.auth.getClaims(),
    () => transports.get(client)?.close(),
  );
}

export async function serverAuth() {
  const config = authConfiguration();
  if (!config) return null;
  const store = await cookies();
  const transport = authTransport();
  const client = createServerClient(config.url, config.key, {
    global: { fetch: transport.fetch },
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          /* Read-only Server Components: proxy persists refreshed cookies. */
        }
      },
    },
  });
  transports.set(client, transport);
  return client;
}

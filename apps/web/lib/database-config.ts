import type { Pool } from "@smartretail/database";
import { supabaseRootCertificate } from "./supabase-root-certificate";

/** One connection per warm serverless instance; never weaken certificate checks. */
export function databaseConfiguration(
  connectionString: string | undefined,
  production: boolean,
): NonNullable<ConstructorParameters<typeof Pool>[0]> {
  try {
    if (!connectionString) throw new Error();
    const url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      production &&
      (!url.hostname.endsWith(".pooler.supabase.com") ||
        url.port !== "6543" ||
        !/^smartretail_api\.[a-z0-9]+$/.test(decodeURIComponent(url.username)))
    )
      throw new Error();
    if (
      url.searchParams.has("sslmode") &&
      !["require", "verify-ca", "verify-full"].includes(
        url.searchParams.get("sslmode") ?? "",
      )
    )
      throw new Error();
    // pg lets URL SSL parameters override its explicit TLS object. Keep TLS
    // configuration authoritative and reject file-based/unsafe overrides.
    for (const key of url.searchParams.keys())
      if (key !== "sslmode") throw new Error();
    url.searchParams.delete("sslmode");
    return {
      connectionString: url.href,
      max: 1,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
      ssl:
        !production && local
          ? false
          : {
              rejectUnauthorized: true,
              ...(url.hostname.endsWith(".pooler.supabase.com")
                ? { ca: supabaseRootCertificate }
                : {}),
            },
    };
  } catch {
    throw new Error("Database configuration unavailable");
  }
}

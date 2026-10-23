import "server-only";
import { UuidSchema } from "@smartretail/contracts";
import { serverAuth, serverClaims } from "./supabase/server";

export async function verifiedUserId(): Promise<string | null> {
  const client = await serverAuth();
  if (!client) return null;
  try {
    const { data, error } = await serverClaims(client);
    if (error) return null;
    const subject = UuidSchema.safeParse(data?.claims.sub);
    return subject.success ? subject.data.toLowerCase() : null;
  } catch {
    return null;
  }
}

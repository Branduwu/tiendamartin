import type { PoolClient } from "pg";

export async function assertApplicationRole(client: PoolClient): Promise<void> {
  const roles = await client.query<{ safe: boolean }>(`SELECT
    NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (current_user,session_user) AND (rolsuper OR rolbypassrls))
    AND NOT pg_has_role(current_user,'smartretail_owner','MEMBER')
    AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='smartretail_members_guard' AND pg_has_role(current_user,oid,'MEMBER'))
    AND pg_has_role(current_user,'smartretail_app','MEMBER')
    AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='retail' AND pg_has_role(current_user,c.relowner,'MEMBER')) AS safe`);
  if (roles.rows[0]?.safe !== true)
    throw new Error("Unsafe database application role");
}

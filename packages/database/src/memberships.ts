import type { Pool } from "pg";
import { productId } from "@smartretail/domain";
import { assertApplicationRole } from "./session";

export type TenantMembership = Readonly<{
  tenantId: string;
  canWriteProducts: boolean;
  permissions: readonly string[];
}>;
/** userId must originate from verified Auth, never from request input. */
export async function listTenantMemberships(
  pool: Pool,
  userId: string,
): Promise<readonly TenantMembership[]> {
  const user = productId(userId).toLowerCase();
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='15s'");
    await assertApplicationRole(client);
    await client.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id','',true)",
      [user],
    );
    const result = await client.query<{
      tenant_id: string;
      can_write: boolean;
      permissions: string[];
    }>(
      `SELECT m.tenant_id,
      EXISTS (SELECT 1 FROM retail.role_permissions p WHERE p.role=m.role AND p.permission='products.write') AS can_write,
      ARRAY(SELECT p.permission FROM retail.role_permissions p WHERE p.role=m.role ORDER BY p.permission) AS permissions
      FROM retail.tenant_memberships m WHERE m.user_id=$1 AND m.status='active' ORDER BY m.tenant_id`,
      [user],
    );
    await client.query("COMMIT");
    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      canWriteProducts: row.can_write,
      permissions: row.permissions,
    }));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

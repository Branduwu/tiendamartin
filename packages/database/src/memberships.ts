import type { Pool } from "pg";
import { productId } from "@smartretail/domain";
import { assertApplicationRole } from "./session";
import type { MemberRole } from "./members";

export type TenantMembership = Readonly<{
  tenantId: string;
  userId: string;
  displayName: string;
  role: MemberRole;
  locationIds: readonly string[];
  allLocations: boolean;
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
      user_id: string;
      display_name: string;
      role: MemberRole;
      all_locations: boolean;
      can_write: boolean;
      permissions: string[];
    }>(
      `SELECT m.tenant_id,m.user_id,coalesce(m.display_name,CASE m.role WHEN 'owner' THEN 'Propietario' WHEN 'admin' THEN 'Administrador' WHEN 'cashier' THEN 'Cajero' ELSE 'Encargado de inventario' END) AS display_name,m.role,
      m.role IN ('owner','admin') AS all_locations,
      EXISTS (SELECT 1 FROM retail.role_permissions p WHERE p.role=m.role AND p.permission='products.write') AS can_write,
      ARRAY(SELECT p.permission FROM retail.role_permissions p WHERE p.role=m.role ORDER BY p.permission) AS permissions
      FROM retail.tenant_memberships m WHERE m.user_id=$1 AND m.status='active' ORDER BY m.tenant_id`,
      [user],
    );
    const memberships: TenantMembership[] = [];
    for (const row of result.rows) {
      // Discovery uses an empty tenant; assignment RLS requires its real scope.
      // Only select scopes obtained from this user's active memberships above.
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [
        row.tenant_id,
      ]);
      const locations = await client.query<{ location_id: string }>(
        "SELECT location_id FROM retail.member_locations WHERE tenant_id=$1 AND user_id=$2 ORDER BY location_id",
        [row.tenant_id, user],
      );
      memberships.push({
        tenantId: row.tenant_id,
        userId: row.user_id,
        displayName: row.display_name,
        role: row.role,
        locationIds: locations.rows.map((location) => location.location_id),
        allLocations: row.all_locations,
        canWriteProducts: row.can_write,
        permissions: row.permissions,
      });
    }
    await client.query("COMMIT");
    return memberships;
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

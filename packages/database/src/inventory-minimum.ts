import type { Pool } from "pg";
import {
  productId as validProductId,
  inventoryLocationId,
  type Quantity,
} from "@smartretail/domain";
import {
  PermissionDeniedError,
  inventoryMinimum,
  type AuthenticatedContext,
  type InventoryMinimumRepository,
} from "@smartretail/application";
import { PostgresInventory } from "./database";
export class PostgresInventoryMinimum
  extends PostgresInventory
  implements InventoryMinimumRepository
{
  constructor(
    pool: Pool,
    context: AuthenticatedContext,
    private readonly correlation = globalThis.crypto.randomUUID(),
  ) {
    super(pool, context);
  }
  async setMinimum(
    productId: string,
    locationId: string,
    minimum: Quantity | null,
  ): Promise<void> {
    validProductId(productId);
    inventoryLocationId(locationId);
    const value = inventoryMinimum(minimum);
    return this.transaction("inventory.minimum.write", async (c) => {
      const p = (
        await c.query<{ unit: Quantity["unit"] }>(
          "SELECT unit FROM retail.products WHERE tenant_id=$1 AND id=$2",
          [this.tenant, productId],
        )
      ).rows[0];
      const l = await c.query(
        "SELECT 1 FROM retail.inventory_locations WHERE tenant_id=$1 AND id=$2",
        [this.tenant, locationId],
      );
      if (!p || !l.rowCount) throw new PermissionDeniedError();
      if (value && p.unit !== value.unit)
        throw new TypeError("Minimum unit must match product");
      await c.query("SELECT set_config('app.correlation_id',$1,true)", [
        this.correlation,
      ]);
      if (value === null)
        await c.query(
          "DELETE FROM retail.inventory_minimums WHERE tenant_id=$1 AND product_id=$2 AND location_id=$3",
          [this.tenant, productId, locationId],
        );
      else
        await c.query(
          "INSERT INTO retail.inventory_minimums(tenant_id,product_id,location_id,unit,milli_units) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,product_id,location_id) DO UPDATE SET milli_units=EXCLUDED.milli_units",
          [
            this.tenant,
            productId,
            locationId,
            value.unit,
            value.milliUnits.toString(),
          ],
        );
    });
  }
}

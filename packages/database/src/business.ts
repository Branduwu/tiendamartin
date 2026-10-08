import { type PoolClient } from "pg";
import { PostgresInventory } from "./database";
import { productId } from "@smartretail/domain";
import {
  defaultBusinessProfile,
  BusinessSettingsNotFoundError,
  type BusinessProfile,
  type BranchSettings,
  type BranchUpdate,
} from "@smartretail/application";
export async function readBusinessProfile(
  c: PoolClient,
  tenant: string,
): Promise<BusinessProfile> {
  const row = (
    await c.query<{ profile: BusinessProfile }>(
      `SELECT jsonb_build_object('businessName',business_name,'tradeName',trade_name,'phone',phone,'email',email,'website',website,'ticketFooter',ticket_footer,'logoUrl',logo_url,'timezone',timezone,'locale',locale,'currency',currency) AS profile FROM retail.business_profiles WHERE tenant_id=$1`,
      [tenant],
    )
  ).rows[0];
  return row?.profile ?? defaultBusinessProfile;
}
export class PostgresBusiness extends PostgresInventory {
  read() {
    return this.transaction(
      "locations.read",
      async (c) => ({
        profile: await readBusinessProfile(c, this.tenant),
        branches: (
          await c.query<BranchSettings>(
            `SELECT id,name,code,display_name AS "displayName",address,phone,receipt_header AS "receiptHeader",status FROM retail.inventory_locations WHERE tenant_id=$1 ORDER BY coalesce(display_name,name),id`,
            [this.tenant],
          )
        ).rows,
      }),
      true,
    );
  }
  save(profile: BusinessProfile, correlation: string) {
    return this.transaction("settings.manage", async (c) => {
      await c.query("SELECT set_config('app.correlation_id',$1,true)", [
        productId(correlation),
      ]);
      await c.query(
        `INSERT INTO retail.business_profiles(tenant_id,business_name,trade_name,phone,email,website,ticket_footer,timezone,locale,currency,logo_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(tenant_id) DO UPDATE SET business_name=excluded.business_name,trade_name=excluded.trade_name,phone=excluded.phone,email=excluded.email,website=excluded.website,ticket_footer=excluded.ticket_footer,timezone=excluded.timezone,locale=excluded.locale,currency=excluded.currency,logo_url=excluded.logo_url`,
        [
          this.tenant,
          profile.businessName,
          profile.tradeName,
          profile.phone,
          profile.email,
          profile.website,
          profile.ticketFooter,
          profile.timezone,
          profile.locale,
          profile.currency,
          profile.logoUrl,
        ],
      );
      return { profile: await readBusinessProfile(c, this.tenant) };
    });
  }
  saveBranch(id: string, input: BranchUpdate, correlation: string) {
    return this.transaction("settings.manage", async (c) => {
      await c.query("SELECT set_config('app.correlation_id',$1,true)", [
        productId(correlation),
      ]);
      const r = await c.query(
        `UPDATE retail.inventory_locations SET display_name=$3,address=$4,phone=$5,receipt_header=$6,status=$7 WHERE tenant_id=$1 AND id=$2 RETURNING id`,
        [
          this.tenant,
          productId(id),
          input.displayName,
          input.address,
          input.phone,
          input.receiptHeader,
          input.status,
        ],
      );
      if (!r.rowCount) throw new BusinessSettingsNotFoundError();
      return { saved: true };
    });
  }
}

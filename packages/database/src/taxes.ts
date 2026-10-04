import type { PoolClient } from "pg";
import {
  productId,
  taxRate,
  applySaleTaxes,
  TaxProfileUnavailableError,
  type CompletedSale,
  type TaxExpectation,
  type TaxRule,
} from "@smartretail/domain";
import { SaleQuoteChangedError } from "@smartretail/application";
import { PostgresInventory } from "./database";
import { bigintParameter } from "./mapping";
type Row = {
  id: string;
  tenant_id: string;
  name: string;
  rate: string;
  active: boolean;
  created_at: Date;
};
const dto = (r: Row) => ({
  id: r.id,
  tenantId: r.tenant_id,
  name: r.name,
  rate: r.rate,
  active: r.active,
  createdAt: r.created_at.toISOString(),
});
export class TaxProfileNotFoundError extends Error {}
export class PostgresTaxes extends PostgresInventory {
  async listTaxProfiles() {
    return this.transaction(
      "products.read",
      async (c) =>
        (
          await c.query<Row>(
            "SELECT * FROM retail.tax_profiles WHERE tenant_id=$1 ORDER BY name,id",
            [this.tenant],
          )
        ).rows.map(dto),
      true,
    );
  }
  async saveTaxProfile(
    input: { id: string; name: string; rate: string; active: boolean },
    update = false,
    correlationId?: string,
  ) {
    const id = productId(input.id).toLowerCase(),
      rate = bigintParameter(taxRate(BigInt(input.rate)));
    if (
      !input.name.trim() ||
      input.name.length > 120 ||
      typeof input.active !== "boolean"
    )
      throw new TypeError("Invalid tax profile");
    return this.transaction("taxes.manage", async (c) => {
      if (correlationId)
        await c.query("SELECT set_config('app.correlation_id',$1,true)", [
          productId(correlationId),
        ]);
      const result = await c.query<Row>(
        update
          ? "UPDATE retail.tax_profiles SET name=$3,rate=$4,active=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *"
          : "INSERT INTO retail.tax_profiles(tenant_id,id,name,rate,active,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          this.tenant,
          id,
          input.name.trim(),
          rate,
          input.active,
          ...(update ? [] : [this.user]),
        ],
      );
      if (!result.rows[0]) throw new TaxProfileNotFoundError();
      return dto(result.rows[0]);
    });
  }
}
export async function priceCatalogTaxes(
  client: PoolClient,
  tenant: string,
  sale: CompletedSale,
  expected?: readonly TaxExpectation[],
  quote = false,
) {
  const configured = await client.query<{
    product_id: string;
    profile_id: string;
    name: string;
    rate: string;
    active: boolean;
  }>(
    "SELECT p.id product_id,t.id profile_id,t.name,t.rate,t.active FROM retail.products p JOIN retail.tax_profiles t ON t.tenant_id=p.tenant_id AND t.id=p.tax_profile_id WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[]) ORDER BY t.id,p.id FOR SHARE OF t",
    [tenant, sale.lines.map((l) => l.productId)],
  );
  if (configured.rows.some((r) => !r.active))
    throw new TaxProfileUnavailableError("Assigned tax profile inactive");
  const rules: TaxRule[] = configured.rows.map((r) => ({
    productId: r.product_id,
    profileId: r.profile_id,
    name: r.name,
    rate: BigInt(r.rate),
  }));
  // Existing untaxed API commands remain compatible; taxed commands must carry
  // quote expectations. Rates are checked, never trusted for calculation.
  if (!quote && (expected !== undefined || rules.length > 0)) {
    if (
      !expected ||
      expected.length !== rules.length ||
      expected.some(
        (e) =>
          !rules.some(
            (r) =>
              r.productId === e.productId &&
              r.profileId === e.profileId &&
              r.rate === e.rate,
          ),
      )
    )
      throw new SaleQuoteChangedError();
  }
  return applySaleTaxes(sale, rules);
}

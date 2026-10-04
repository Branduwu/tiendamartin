import type { PoolClient } from "pg";
import {
  discount,
  couponCode,
  priceDiscountedSale,
  DiscountUnavailableError,
  productId,
  type CompletedSale,
  type DiscountIntent,
  type DiscountRule,
} from "@smartretail/domain";
import { PermissionDeniedError } from "@smartretail/application";
import { PostgresInventory } from "./database";
import { bigintParameter } from "./mapping";

type CatalogRow = {
  id: string;
  tenant_id: string;
  discount_type: "amount" | "percentage";
  discount_value: string;
  active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  code?: string;
  name?: string;
  product_id?: string;
  usage_limit?: string | null;
  uses?: string;
  available?: boolean;
};
export type CatalogInput = Readonly<{
  id: string;
  discount: Readonly<{ type: "amount" | "percentage"; value: string }>;
  active: boolean;
  startsAt?: string;
  endsAt?: string;
}>;
export type CouponInput = CatalogInput &
  Readonly<{ code: string; usageLimit?: string }>;
export type PromotionInput = CatalogInput &
  Readonly<{ name: string; productId: string }>;
export class PromotionNotFoundError extends Error {}
const mapped = (r: CatalogRow) => ({
  id: r.id,
  tenantId: r.tenant_id,
  discount: { type: r.discount_type, value: r.discount_value },
  active: r.active,
  ...(r.starts_at === null ? {} : { startsAt: r.starts_at.toISOString() }),
  ...(r.ends_at === null ? {} : { endsAt: r.ends_at.toISOString() }),
});
function parameters(input: CatalogInput) {
  const d = discount(input.discount.type, BigInt(input.discount.value));
  if (
    typeof input.active !== "boolean" ||
    (input.startsAt !== undefined &&
      !Number.isFinite(Date.parse(input.startsAt))) ||
    (input.endsAt !== undefined &&
      !Number.isFinite(Date.parse(input.endsAt))) ||
    (input.startsAt &&
      input.endsAt &&
      Date.parse(input.startsAt) >= Date.parse(input.endsAt))
  )
    throw new TypeError("Invalid catalog period");
  return [
    d.type,
    bigintParameter(d.value),
    input.active,
    input.startsAt ?? null,
    input.endsAt ?? null,
  ];
}
export class PostgresPromotions extends PostgresInventory {
  async listCoupons() {
    return this.transaction("promotions.read", async (client) =>
      (
        await client.query<CatalogRow>(
          "SELECT *,retail.coupon_uses(id)::text uses FROM retail.coupons WHERE tenant_id=$1 ORDER BY code",
          [this.tenant],
        )
      ).rows.map((r) => ({
        ...mapped(r),
        code: r.code!,
        uses: r.uses!,
        ...(r.usage_limit == null ? {} : { usageLimit: r.usage_limit }),
      })),
    );
  }
  async listPromotions() {
    return this.transaction("promotions.read", async (client) =>
      (
        await client.query<CatalogRow>(
          "SELECT * FROM retail.promotions WHERE tenant_id=$1 ORDER BY name,id",
          [this.tenant],
        )
      ).rows.map((r) => ({
        ...mapped(r),
        name: r.name!,
        productId: r.product_id!,
      })),
    );
  }
  async saveCoupon(
    input: CouponInput,
    update = false,
    correlation = globalThis.crypto.randomUUID(),
  ) {
    const id = productId(input.id).toLowerCase(),
      code = couponCode(input.code),
      p = parameters(input);
    const limit =
      input.usageLimit === undefined
        ? null
        : bigintParameter(BigInt(input.usageLimit));
    if (limit !== null && BigInt(limit) <= 0n)
      throw new TypeError("Invalid coupon usage limit");
    return this.transaction("promotions.write", async (client) => {
      await client.query("SELECT set_config('app.correlation_id',$1,true)", [
        productId(correlation),
      ]);
      const result = await client.query<CatalogRow>(
        update
          ? "UPDATE retail.coupons SET code=$3,discount_type=$4,discount_value=$5,active=$6,starts_at=$7,ends_at=$8,usage_limit=$9 WHERE tenant_id=$1 AND id=$2 RETURNING *"
          : "INSERT INTO retail.coupons(tenant_id,id,code,discount_type,discount_value,active,starts_at,ends_at,usage_limit,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [this.tenant, id, code, ...p, limit, ...(update ? [] : [this.user])],
      );
      if (!result.rows[0]) throw new PromotionNotFoundError();
      const r = result.rows[0];
      const uses = (
        await client.query<{ uses: string }>(
          "SELECT retail.coupon_uses($1)::text uses",
          [id],
        )
      ).rows[0]!.uses;
      return {
        ...mapped(r),
        code: r.code!,
        uses,
        ...(r.usage_limit == null ? {} : { usageLimit: r.usage_limit }),
      };
    });
  }
  async savePromotion(
    input: PromotionInput,
    update = false,
    correlation = globalThis.crypto.randomUUID(),
  ) {
    const id = productId(input.id).toLowerCase(),
      product = productId(input.productId).toLowerCase(),
      p = parameters(input);
    if (
      typeof input.name !== "string" ||
      input.name.length < 1 ||
      input.name.length > 120 ||
      input.name.trim() !== input.name
    )
      throw new TypeError("Invalid promotion name");
    return this.transaction("promotions.write", async (client) => {
      await client.query("SELECT set_config('app.correlation_id',$1,true)", [
        productId(correlation),
      ]);
      if (
        !(
          await client.query(
            "SELECT 1 FROM retail.products WHERE tenant_id=$1 AND id=$2",
            [this.tenant, product],
          )
        ).rows.length
      )
        throw new PromotionNotFoundError();
      const result = await client.query<CatalogRow>(
        update
          ? "UPDATE retail.promotions SET product_id=$3,name=$4,discount_type=$5,discount_value=$6,active=$7,starts_at=$8,ends_at=$9 WHERE tenant_id=$1 AND id=$2 RETURNING *"
          : "INSERT INTO retail.promotions(tenant_id,id,product_id,name,discount_type,discount_value,active,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [
          this.tenant,
          id,
          product,
          input.name,
          ...p,
          ...(update ? [] : [this.user]),
        ],
      );
      if (!result.rows[0]) throw new PromotionNotFoundError();
      const r = result.rows[0];
      return { ...mapped(r), name: r.name!, productId: r.product_id! };
    });
  }
}
export async function priceCatalogSale(
  client: PoolClient,
  tenant: string,
  user: string,
  sale: CompletedSale,
  intent: DiscountIntent = {},
) {
  const member = (
    await client.query<{ role: string; allowed: boolean }>(
      "SELECT role,retail.has_permission('sales.discount') allowed FROM retail.tenant_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active'",
      [tenant, user],
    )
  ).rows[0];
  if (
    !member ||
    ((intent.sale !== undefined || (intent.lines?.length ?? 0) > 0) &&
      !member.allowed)
  )
    throw new PermissionDeniedError();
  const promotions = (
    await client.query<CatalogRow>(
      "SELECT * FROM retail.promotions WHERE tenant_id=$1 AND product_id=ANY($2::uuid[]) AND active AND (starts_at IS NULL OR starts_at<=transaction_timestamp()) AND (ends_at IS NULL OR ends_at>transaction_timestamp()) ORDER BY id FOR SHARE",
      [tenant, sale.lines.map((l) => l.productId)],
    )
  ).rows;
  let coupon: DiscountRule | undefined;
  if (intent.couponCode !== undefined) {
    const code = couponCode(intent.couponCode),
      found = (
        await client.query<{ id: string }>(
          "SELECT id FROM retail.coupons WHERE tenant_id=$1 AND code=$2",
          [tenant, code],
        )
      ).rows[0];
    if (!found)
      throw new DiscountUnavailableError("Cupón inválido o no disponible.");
    const c = (
      await client.query<CatalogRow>(
        "SELECT c.*,c.active AND (c.starts_at IS NULL OR c.starts_at<=clock_timestamp()) AND (c.ends_at IS NULL OR c.ends_at>clock_timestamp()) available,retail.coupon_uses(c.id)::text uses FROM retail.lock_coupon($1) c",
        [found.id],
      )
    ).rows[0];
    if (!c || !c.available || c.code !== code)
      throw new DiscountUnavailableError(
        "Cupón inactivo, fuera de vigencia o expirado.",
      );
    if (
      c.usage_limit !== null &&
      c.usage_limit !== undefined &&
      BigInt(c.uses ?? "0") >= BigInt(c.usage_limit)
    )
      throw new DiscountUnavailableError("Cupón agotado.");
    coupon = {
      id: c.id,
      code,
      discount: discount(c.discount_type, BigInt(c.discount_value)),
    };
  }
  return priceDiscountedSale(
    { ...sale, status: "draft" },
    intent,
    promotions.map((p) => ({
      id: p.id,
      productId: p.product_id!,
      name: p.name!,
      discount: discount(p.discount_type, BigInt(p.discount_value)),
    })),
    coupon,
    member.role === "cashier",
  );
}
export function discountIntentJson(intent: DiscountIntent = {}) {
  return {
    ...(intent.sale === undefined
      ? {}
      : {
          sale: { type: intent.sale.type, value: intent.sale.value.toString() },
        }),
    ...(intent.lines === undefined
      ? {}
      : {
          lines: intent.lines.map((l) => ({
            productId: l.productId,
            discount: {
              type: l.discount.type,
              value: l.discount.value.toString(),
            },
          })),
        }),
    ...(intent.couponCode === undefined
      ? {}
      : { couponCode: intent.couponCode }),
  };
}

import { z } from "zod";
import { UuidSchema } from "./identifiers";
import { ProductNameSchema } from "./product-fields";

const Integer = z
  .string()
  .max(128)
  .regex(/^(?:0|[1-9][0-9]*)$/);
export const DiscountSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("amount"), value: Integer }),
  z.strictObject({
    type: z.literal("percentage"),
    value: Integer.pipe(z.string().refine((v) => BigInt(v) <= 10000n)),
  }),
]);
export const CouponCodeSchema = z
  .string()
  .max(64)
  .transform((v) => v.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/));
export const DiscountIntentSchema = z.strictObject({
  sale: DiscountSchema.exactOptional(),
  lines: z
    .array(z.strictObject({ productId: UuidSchema, discount: DiscountSchema }))
    .max(1000)
    .refine(
      (v) => new Set(v.map((l) => l.productId.toLowerCase())).size === v.length,
    )
    .exactOptional(),
  couponCode: CouponCodeSchema.exactOptional(),
});
const period = {
  active: z.boolean(),
  startsAt: z.iso.datetime({ offset: true }).exactOptional(),
  endsAt: z.iso.datetime({ offset: true }).exactOptional(),
};
const validPeriod = (v: { startsAt?: string; endsAt?: string }) =>
  !v.startsAt || !v.endsAt || Date.parse(v.startsAt) < Date.parse(v.endsAt);
const CouponFields = z.strictObject({
  code: CouponCodeSchema,
  discount: DiscountSchema,
  ...period,
  usageLimit: Integer.pipe(
    z
      .string()
      .refine((s) => BigInt(s) > 0n && BigInt(s) <= 9223372036854775807n),
  ).exactOptional(),
});
export const CouponInputSchema = CouponFields.extend({ id: UuidSchema }).refine(
  validPeriod,
);
export const CouponUpdateSchema = CouponFields.refine(validPeriod);
export const CouponSchema = CouponFields.extend({
  id: UuidSchema,
  tenantId: UuidSchema,
  uses: Integer,
}).refine(validPeriod);
const PromotionFields = z.strictObject({
  name: ProductNameSchema,
  productId: UuidSchema,
  discount: DiscountSchema,
  ...period,
});
export const PromotionInputSchema = PromotionFields.extend({
  id: UuidSchema,
}).refine(validPeriod);
export const PromotionUpdateSchema = PromotionFields.refine(validPeriod);
export const PromotionSchema = PromotionFields.extend({
  id: UuidSchema,
  tenantId: UuidSchema,
}).refine(validPeriod);
export const DiscountDetailsSchema = z.strictObject({
  lineDiscountTotal: Integer,
  saleDiscountTotal: Integer,
  couponDiscountTotal: Integer,
  manualSale: DiscountSchema.exactOptional(),
  coupon: z
    .strictObject({
      id: UuidSchema,
      code: CouponCodeSchema,
      type: z.enum(["amount", "percentage"]),
      value: Integer,
    })
    .exactOptional(),
  lines: z
    .array(
      z.strictObject({
        productId: UuidSchema,
        source: z.enum(["none", "manual", "promotion"]),
        type: z.enum(["amount", "percentage"]),
        value: Integer,
        lineDiscount: Integer,
        saleAllocation: Integer,
        couponAllocation: Integer,
        promotionId: UuidSchema.exactOptional(),
        promotionName: ProductNameSchema.exactOptional(),
      }),
    )
    .max(1000)
    .readonly(),
});
export type DiscountDto = z.infer<typeof DiscountSchema>;
export type DiscountIntentDto = z.infer<typeof DiscountIntentSchema>;
export type DiscountDetailsDto = z.infer<typeof DiscountDetailsSchema>;
export type CouponInputDto = z.infer<typeof CouponInputSchema>;
export type CouponDto = z.infer<typeof CouponSchema>;
export type PromotionInputDto = z.infer<typeof PromotionInputSchema>;
export type PromotionDto = z.infer<typeof PromotionSchema>;

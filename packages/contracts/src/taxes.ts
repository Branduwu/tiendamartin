import { z } from "zod";
import { UuidSchema } from "./identifiers";
import { MoneySchema } from "./money";
import { ProductNameSchema } from "./product-fields";
const Nonnegative = MoneySchema.shape.minorUnits.refine(
  (s) => !s.startsWith("-"),
);
export const TaxRateSchema = Nonnegative.pipe(
  z.string().refine((s) => BigInt(s) <= 1000000n),
);
export const TaxProfileFieldsSchema = z.strictObject({
  name: ProductNameSchema,
  rate: TaxRateSchema,
  active: z.boolean(),
});
export const TaxProfileInputSchema = TaxProfileFieldsSchema.extend({
  id: UuidSchema,
});
export const TaxProfileSchema = TaxProfileInputSchema.extend({
  tenantId: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
});
const TaxSnapshotShape = z.strictObject({
  profileId: UuidSchema,
  name: ProductNameSchema,
  rate: TaxRateSchema,
  base: MoneySchema,
  amount: MoneySchema,
});
export const TaxSnapshotSchema = TaxSnapshotShape.refine(
  (v) =>
    !v.base.minorUnits.startsWith("-") &&
    !v.amount.minorUnits.startsWith("-") &&
    BigInt(v.amount.minorUnits) ===
      (BigInt(v.base.minorUnits) * BigInt(v.rate) + 5000n) / 10000n,
  { when: (p) => TaxSnapshotShape.safeParse(p.value).success },
);
export const TaxExpectationsSchema = z
  .array(
    z.strictObject({
      productId: UuidSchema,
      profileId: UuidSchema,
      rate: TaxRateSchema,
    }),
  )
  .max(1000)
  .refine(
    (a) => new Set(a.map((r) => r.productId.toLowerCase())).size === a.length,
  );
export type TaxProfileDto = z.infer<typeof TaxProfileSchema>;
export type TaxSnapshotDto = z.infer<typeof TaxSnapshotSchema>;

import { z } from "zod";
import { UuidSchema } from "./identifiers";
import {
  ProductIdSchema,
  ProductNameSchema,
  SkuSchema,
} from "./product-fields";
import { UnitCodeSchema } from "./unit";
import { MoneySchema } from "./money";
import { QuantitySchema } from "./quantity";

export const SaleIdSchema = z.string().length(36).pipe(UuidSchema);
const PriceSchema = MoneySchema.refine(
  (value) => !value.minorUnits.startsWith("-"),
);
const PositiveQuantitySchema = QuantitySchema.refine(
  (value) => value.milliUnits !== "0" && !value.milliUnits.startsWith("-"),
);

const LineShapeSchema = z.strictObject({
  productId: ProductIdSchema,
  sku: SkuSchema,
  name: ProductNameSchema,
  unit: UnitCodeSchema,
  quantity: PositiveQuantitySchema,
  unitPrice: PriceSchema,
  lineTotal: PriceSchema,
});
export const SaleLineSchema = LineShapeSchema.refine(
  (line) => line.unit === line.quantity.unit,
  "Sale quantity unit mismatch",
).refine(
  (line) =>
    BigInt(line.lineTotal.minorUnits) ===
    (BigInt(line.unitPrice.minorUnits) * BigInt(line.quantity.milliUnits) +
      500n) /
      1000n,
  {
    message: "Inconsistent sale line total",
    when: (payload) => LineShapeSchema.safeParse(payload.value).success,
  },
);

// Technical transport bound, not a limit on the domain/business sale size.
const LinesSchema = z
  .custom<unknown[]>(Array.isArray)
  .refine((lines) => lines.length <= 1000, {
    abort: true,
    message: "Technical transport limit: 1000 lines",
  })
  .pipe(z.array(SaleLineSchema));
const shape = { id: SaleIdSchema, lines: LinesSchema, total: PriceSchema };
const envelope = z.discriminatedUnion("status", [
  z.strictObject({ ...shape, status: z.literal("draft") }),
  z.strictObject({ ...shape, status: z.literal("completed") }),
]);
export const SaleSchema = envelope
  .refine((sale) => {
    const ids = sale.lines.map((line) => line.productId.toLowerCase());
    return new Set(ids).size === ids.length;
  }, "Duplicate sale product")
  .refine(
    (sale) => {
      const total = sale.lines.reduce(
        (sum, line) => sum + BigInt(line.lineTotal.minorUnits),
        0n,
      );
      return total === BigInt(sale.total.minorUnits);
    },
    {
      message: "Inconsistent sale total",
      when: (payload) => envelope.safeParse(payload.value).success,
    },
  )
  .refine(
    (sale) => sale.status !== "completed" || sale.lines.length > 0,
    "Cannot complete an empty sale",
  );
export const SaleDraftSchema = SaleSchema.transform((sale, ctx) => {
  if (sale.status !== "draft") {
    ctx.addIssue({ code: "custom", message: "Expected draft sale" });
    return z.NEVER;
  }
  return sale;
});
export const CompletedSaleSchema = SaleSchema.transform((sale, ctx) => {
  if (sale.status !== "completed") {
    ctx.addIssue({ code: "custom", message: "Expected completed sale" });
    return z.NEVER;
  }
  return sale;
});
export type SaleLineDto = z.infer<typeof SaleLineSchema>;
export type SaleDto = z.infer<typeof SaleSchema>;
export type SaleDraftDto = z.infer<typeof SaleDraftSchema>;
export type CompletedSaleDto = z.infer<typeof CompletedSaleSchema>;

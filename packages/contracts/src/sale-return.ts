import { z } from "zod";
import { UuidSchema } from "./identifiers";
import { QuantitySchema } from "./quantity";
import { MoneySchema } from "./money";
import { SalePaymentSchema } from "./checkout";
export const SaleReturnIdSchema = UuidSchema;
const ReturnQuantity = QuantitySchema.refine(
  (q) =>
    QuantitySchema.safeParse(q).success &&
    BigInt(q.milliUnits) > 0n &&
    (q.unit !== "piece" || BigInt(q.milliUnits) % 1000n === 0n),
);
const RefundPaymentSchema = SalePaymentSchema.extend({
  method: z.enum(["cash", "card"]),
});
export const CreateSaleReturnSchema = z
  .strictObject({
    id: SaleReturnIdSchema,
    shiftId: UuidSchema.exactOptional(),
    cashMovementId: UuidSchema.exactOptional(),
    lines: z
      .array(
        z.strictObject({
          saleLineId: UuidSchema,
          productId: UuidSchema,
          quantity: ReturnQuantity,
          movementId: UuidSchema,
        }),
      )
      .min(1)
      .max(1000),
    refunds: z.array(RefundPaymentSchema).max(2),
  })
  .refine(
    (v) =>
      new Set(v.lines.map((l) => l.productId.toLowerCase())).size ===
        v.lines.length &&
      new Set(v.lines.map((l) => l.movementId.toLowerCase())).size ===
        v.lines.length &&
      v.lines.every(
        (l) => l.saleLineId.toLowerCase() === l.productId.toLowerCase(),
      ) &&
      new Set(v.refunds.map((p) => p.method)).size === v.refunds.length,
  );
export const SaleReturnSchema = z.strictObject({
  id: SaleReturnIdSchema,
  saleId: UuidSchema,
  status: z.literal("completed"),
  tenantId: UuidSchema,
  locationId: UuidSchema,
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  shiftId: UuidSchema.nullable(),
  cashMovementId: UuidSchema.nullable(),
  lines: z
    .array(
      z.strictObject({
        saleLineId: UuidSchema,
        productId: UuidSchema,
        quantity: ReturnQuantity,
        refunded: MoneySchema,
        refundedTax: MoneySchema.exactOptional(),
      }),
    )
    .min(1)
    .max(1000),
  total: MoneySchema,
  debtReduction: MoneySchema.exactOptional(),
  refunds: z.array(RefundPaymentSchema).max(2),
});
export type CreateSaleReturnDto = z.infer<typeof CreateSaleReturnSchema>;
export type SaleReturnDto = z.infer<typeof SaleReturnSchema>;

import { z } from "zod";
import { MoneySchema } from "./money";
import { SaleDraftSchema, CompletedSaleSchema } from "./sale";
import { UuidSchema } from "./identifiers";
export const SalePaymentSchema = z.strictObject({
  method: z.enum(["cash", "card"]),
  amount: MoneySchema.refine(
    (v) => v.minorUnits !== "0" && !v.minorUnits.startsWith("-"),
  ),
});
const PaymentsSchema = z
  .array(SalePaymentSchema)
  .max(2)
  .refine((p) => new Set(p.map((v) => v.method)).size === p.length);
export const CheckoutSchema = z.strictObject({
  shiftId: UuidSchema.exactOptional(),
  suspendedSaleId: UuidSchema.exactOptional(),
  draft: SaleDraftSchema,
  locationId: UuidSchema,
  payments: PaymentsSchema,
  movements: z
    .array(z.strictObject({ productId: UuidSchema, movementId: UuidSchema }))
    .min(1)
    .max(1000),
});
export const StoredSaleSchema = z.strictObject({
  shiftId: UuidSchema.nullable(),
  customerName: z.string().min(1).max(200).exactOptional(),
  sale: CompletedSaleSchema,
  payments: PaymentsSchema,
  locationId: UuidSchema,
  tenantId: UuidSchema,
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
});
export type CheckoutDto = z.infer<typeof CheckoutSchema>;
export type StoredSaleDto = z.infer<typeof StoredSaleSchema>;

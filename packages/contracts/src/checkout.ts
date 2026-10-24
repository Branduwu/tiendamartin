import { TaxExpectationsSchema } from "./taxes";
import { z } from "zod";
import { MoneySchema } from "./money";
import { InventoryLocationNameSchema } from "./inventory-location";
import { SaleDraftSchema, CompletedSaleSchema } from "./sale";
import { UuidSchema } from "./identifiers";
import { MemberDisplayNameSchema } from "./members";
import { DiscountIntentSchema, DiscountDetailsSchema } from "./discounts";
export const SalePaymentSchema = z.strictObject({
  method: z.enum(["cash", "card", "credit"]),
  amount: MoneySchema.refine(
    (v) => v.minorUnits !== "0" && !v.minorUnits.startsWith("-"),
  ),
});
const PaymentsSchema = z
  .array(SalePaymentSchema)
  .max(3)
  .refine((p) => new Set(p.map((v) => v.method)).size === p.length);
export const CheckoutSchema = z.strictObject({
  shiftId: UuidSchema.exactOptional(),
  suspendedSaleId: UuidSchema.exactOptional(),
  draft: SaleDraftSchema,
  locationId: UuidSchema,
  payments: PaymentsSchema,
  discounts: DiscountIntentSchema.exactOptional(),
  taxes: TaxExpectationsSchema.exactOptional(),
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
  createdByName: MemberDisplayNameSchema.exactOptional(),
  locationName: InventoryLocationNameSchema.exactOptional(),
  createdAt: z.iso.datetime({ offset: true }),
  details: DiscountDetailsSchema.exactOptional(),
});
export const SaleQuoteSchema = z.strictObject({
  draft: SaleDraftSchema,
  locationId: UuidSchema,
  discounts: DiscountIntentSchema.exactOptional(),
  taxes: TaxExpectationsSchema.exactOptional(),
});
const HistoryDateSchema = z.iso
  .date()
  .refine((v) => v >= "1900-01-01" && v <= "9998-12-31");
const HistoryCursorSchema = z
  .string()
  .max(100)
  .refine((value) => {
    const parts = value.split("~");
    return (
      parts.length === 2 &&
      z.iso.datetime({ precision: 6 }).safeParse(parts[0]).success &&
      UuidSchema.safeParse(parts[1]).success
    );
  }, "Cursor de ventas inválido");
export const SalesHistoryQuerySchema = z
  .strictObject({
    cursor: HistoryCursorSchema.exactOptional(),
    q: z.string().trim().min(1).max(80).exactOptional(),
    from: HistoryDateSchema.exactOptional(),
    to: HistoryDateSchema.exactOptional(),
    locationId: UuidSchema.exactOptional(),
    payment: z.enum(["cash", "card", "credit"]).exactOptional(),
  })
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "Revisa el intervalo de fechas",
  );
export type SalesHistoryQueryDto = z.infer<typeof SalesHistoryQuerySchema>;

export type CheckoutDto = z.infer<typeof CheckoutSchema>;
export type StoredSaleDto = z.infer<typeof StoredSaleSchema>;

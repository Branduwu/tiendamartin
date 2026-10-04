import { z } from "zod";
import { UuidSchema } from "./identifiers";
import { MoneySchema } from "./money";
const NonnegativeMoney = MoneySchema.refine(
  (m) => !m.minorUnits.startsWith("-"),
);
export const ReceivablePaymentInputSchema = z
  .strictObject({
    id: UuidSchema,
    method: z.enum(["cash", "card"]),
    amount: NonnegativeMoney.refine((m) => m.minorUnits !== "0"),
    shiftId: UuidSchema.exactOptional(),
  })
  .refine((p) =>
    p.method === "cash" ? p.shiftId !== undefined : p.shiftId === undefined,
  );
export const ReceivablePaymentSchema = z.strictObject({
  id: UuidSchema,
  receivableId: UuidSchema,
  method: z.enum(["cash", "card"]),
  amount: NonnegativeMoney,
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: UuidSchema,
  shiftId: UuidSchema.nullable(),
});
export const ReceivableSchema = z.strictObject({
  id: UuidSchema,
  tenantId: UuidSchema,
  saleId: UuidSchema,
  customerId: UuidSchema,
  customerName: z.string().min(1).max(200),
  locationId: UuidSchema,
  originalAmount: NonnegativeMoney,
  paidAmount: NonnegativeMoney,
  returnedAmount: NonnegativeMoney,
  outstandingAmount: NonnegativeMoney,
  status: z.enum(["open", "partially_paid", "paid"]),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ReceivableDto = z.infer<typeof ReceivableSchema>;
export type ReceivablePaymentDto = z.infer<typeof ReceivablePaymentSchema>;
export type ReceivablePaymentInputDto = z.infer<
  typeof ReceivablePaymentInputSchema
>;

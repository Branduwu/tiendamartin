import { z } from "zod";
import { UuidSchema } from "./identifiers";
import { MemberDisplayNameSchema } from "./members";
import { MoneySchema } from "./money";
const Nonnegative = MoneySchema.refine((v) => !v.minorUnits.startsWith("-"));
export const OpenCashShiftSchema = z.strictObject({
  id: UuidSchema,
  locationId: UuidSchema,
  openingCash: Nonnegative,
});
export const CashMovementInputSchema = z.strictObject({
  id: UuidSchema,
  shiftId: UuidSchema,
  type: z.enum(["cash_in", "cash_out"]),
  amount: Nonnegative.refine((v) => v.minorUnits !== "0"),
  reason: z
    .string()
    .min(1)
    .max(200)
    .refine(
      (v) =>
        v.trim() === v &&
        /[^\p{Cf}\p{M}\p{Z}]/u.test(v) &&
        !/[\p{Cc}\p{Cs}\p{Cf}]/u.test(v),
    ),
});
export const CloseCashShiftSchema = z.strictObject({
  shiftId: UuidSchema,
  countedCash: Nonnegative,
});
export const CashShiftSchema = z.strictObject({
  id: UuidSchema,
  tenantId: UuidSchema,
  locationId: UuidSchema,
  openedBy: UuidSchema,
  openedByName: MemberDisplayNameSchema.exactOptional(),
  openedAt: z.iso.datetime(),
  openingCash: Nonnegative,
  status: z.enum(["open", "closed"]),
  salesCash: Nonnegative,
  cashIn: Nonnegative,
  cashOut: Nonnegative,
  expectedCash: Nonnegative,
  closedBy: UuidSchema.nullable(),
  closedByName: MemberDisplayNameSchema.exactOptional(),
  closedAt: z.iso.datetime().nullable(),
  countedCash: Nonnegative.nullable(),
  difference: MoneySchema.nullable(),
});
export type CashShiftDto = z.infer<typeof CashShiftSchema>;

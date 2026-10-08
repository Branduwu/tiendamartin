import { z } from "zod";
import { UuidSchema } from "./identifiers";
import { MoneySchema } from "./money";
const PositiveMoney = MoneySchema.refine(
  (v) => !v.minorUnits.startsWith("-") && v.minorUnits !== "0",
  "Positive amount required",
);
export const SupplierPaymentSchema = z
  .strictObject({
    id: UuidSchema,
    method: z.enum(["cash", "card", "bank"]),
    amount: PositiveMoney,
    shiftId: UuidSchema.optional(),
  })
  .refine(
    (v) => (v.method === "cash") === (v.shiftId !== undefined),
    "Cash requires shift; noncash forbids shift",
  );
export const ExpenseSchema = z
  .strictObject({
    id: UuidSchema,
    category: z.enum([
      "renta",
      "servicios",
      "transporte",
      "mantenimiento",
      "insumos",
      "otros",
    ]),
    description: z
      .string()
      .min(1)
      .max(500)
      .refine((v) => v.trim() === v && !/\p{Cc}/u.test(v)),
    amount: PositiveMoney,
    method: z.enum(["cash", "card", "bank"]),
    locationId: UuidSchema.optional(),
    shiftId: UuidSchema.optional(),
  })
  .refine(
    (v) =>
      (v.method === "cash") === (v.shiftId !== undefined) &&
      (v.method !== "cash" || v.locationId !== undefined),
    "Cash requires location/shift",
  );
export type ExpenseInputDto = z.infer<typeof ExpenseSchema>;
export type SupplierPaymentDto = z.infer<typeof SupplierPaymentSchema>;

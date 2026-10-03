import { z } from "zod";
import { canonicalIntegerString } from "./canonical-integer";

export const MoneySchema = z.strictObject({
  currency: z.literal("MXN"),
  minorUnits: canonicalIntegerString("minorUnits"),
});

export type MoneyDto = z.infer<typeof MoneySchema>;

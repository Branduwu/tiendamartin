import { z } from "zod";
import { canonicalIntegerString } from "./canonical-integer";
import { UnitCodeSchema } from "./unit";

/** Serializable fixed-three-decimal quantity; no conversion to domain values. */
export const QuantitySchema = z.strictObject({
  unit: UnitCodeSchema,
  milliUnits: canonicalIntegerString("milliUnits"),
});

export type QuantityDto = z.infer<typeof QuantitySchema>;

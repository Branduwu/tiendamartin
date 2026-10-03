import { z } from "zod";
import { UuidSchema } from "./identifiers";
import { QuantitySchema } from "./quantity";
export const SetInventoryMinimumSchema = z.strictObject({
  productId: UuidSchema,
  locationId: UuidSchema,
  minimumStock: QuantitySchema.refine((q) => {
    if (!/^(0|[1-9]\d{0,18})$/.test(q.milliUnits)) return false;
    const n = BigInt(q.milliUnits);
    return (
      n >= 0n &&
      n <= 9223372036854775807n &&
      (q.unit !== "piece" || n % 1000n === 0n)
    );
  }, "Expected nonnegative representable quantity; pieces must be whole").nullable(),
});
export const InventoryAlertQuerySchema = z.strictObject({
  locationId: UuidSchema.optional(),
  productId: UuidSchema.optional(),
});
export type InventoryPrefillDto = Readonly<{
  tenantId: string;
  productId: string;
  locationId: string;
  quantityOrdered: {
    unit: ReturnType<typeof QuantitySchema.parse>["unit"];
    milliUnits: string;
  };
}>;

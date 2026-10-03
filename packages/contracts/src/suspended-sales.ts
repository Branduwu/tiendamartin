import { z } from "zod";
import { UuidSchema } from "./identifiers";
import { QuantitySchema } from "./quantity";
export const SuspendSaleSchema = z
  .strictObject({
    id: UuidSchema,
    locationId: UuidSchema,
    lines: z
      .array(
        z.strictObject({
          productId: UuidSchema,
          quantity: QuantitySchema.refine((q) => {
            if (!QuantitySchema.safeParse(q).success) return false;
            const amount = BigInt(q.milliUnits);
            return amount > 0n && (q.unit !== "piece" || amount % 1000n === 0n);
          }),
        }),
      )
      .min(1)
      .max(1000),
  })
  .refine(
    (v) =>
      new Set(v.lines.map((l) => l.productId.toLowerCase())).size ===
      v.lines.length,
  );
export const SuspendedSaleSchema = z.strictObject({
  id: UuidSchema,
  locationId: UuidSchema,
  lines: SuspendSaleSchema.shape.lines,
  tenantId: UuidSchema,
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  status: z.enum(["suspended", "completed", "cancelled"]),
});
export type SuspendSaleDto = z.infer<typeof SuspendSaleSchema>;
export type SuspendedSaleDto = z.infer<typeof SuspendedSaleSchema>;

export const RecoverSuspendedSaleSchema = z.strictObject({
  saleId: UuidSchema,
});
export const CancelSuspendedSaleSchema = z.strictObject({});

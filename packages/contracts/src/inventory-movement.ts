import { z } from "zod";
import { ProductIdSchema } from "./product-fields";
import { InventoryLocationIdSchema } from "./inventory-location";
import { QuantitySchema } from "./quantity";

export const InventoryMovementIdSchema = ProductIdSchema;
export const InventoryAdjustmentReasonSchema = z
  .string()
  .refine((value) => value.length >= 1 && value.length <= 400, { abort: true })
  .refine(
    (value) =>
      [...value].length <= 200 &&
      value.trim() === value &&
      /[^\p{Cf}\p{M}\p{Z}]/u.test(value) &&
      !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value) &&
      !/(?:(?![\u200c\u200d])\p{Cf})/u.test(value),
    "Invalid InventoryMovement reason",
  );

// Canonical strings carry enough sign information; no BigInt conversion needed.
const PositiveQuantitySchema = QuantitySchema.refine(
  (value) => value.milliUnits !== "0" && !value.milliUnits.startsWith("-"),
  "Expected strictly positive quantity",
);
const NonzeroQuantitySchema = QuantitySchema.refine(
  (value) => value.milliUnits !== "0",
  "Expected nonzero delta",
);
const targetShape = {
  id: InventoryMovementIdSchema,
  productId: ProductIdSchema,
  locationId: InventoryLocationIdSchema,
};
export const InventoryReceiptSchema = z.strictObject({
  ...targetShape,
  type: z.literal("receipt"),
  quantity: PositiveQuantitySchema,
});
export const InventoryIssueSchema = z.strictObject({
  ...targetShape,
  type: z.literal("issue"),
  quantity: PositiveQuantitySchema,
});
export const InventoryAdjustmentSchema = z.strictObject({
  ...targetShape,
  type: z.literal("adjustment"),
  delta: NonzeroQuantitySchema,
  reason: InventoryAdjustmentReasonSchema,
});
export const InventoryMovementSchema = z.discriminatedUnion("type", [
  InventoryReceiptSchema,
  InventoryIssueSchema,
  InventoryAdjustmentSchema,
]);
export type InventoryReceiptDto = z.infer<typeof InventoryReceiptSchema>;
export type InventoryIssueDto = z.infer<typeof InventoryIssueSchema>;
export type InventoryAdjustmentDto = z.infer<typeof InventoryAdjustmentSchema>;
export type InventoryMovementDto = z.infer<typeof InventoryMovementSchema>;

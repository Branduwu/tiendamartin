import { z } from "zod";
import { ProductIdSchema } from "./product-fields";
import { InventoryMovementIdSchema } from "./inventory-movement";
import { InventoryLocationIdSchema } from "./inventory-location";
import { QuantitySchema } from "./quantity";

export const InventoryTransferIdSchema = ProductIdSchema;
const PositiveQuantitySchema = QuantitySchema.refine(
  (value) => value.milliUnits !== "0" && !value.milliUnits.startsWith("-"),
  "Expected strictly positive quantity",
);
export const InventoryTransferSchema = z
  .strictObject({
    id: InventoryTransferIdSchema,
    issueMovementId: InventoryMovementIdSchema,
    receiptMovementId: InventoryMovementIdSchema,
    productId: ProductIdSchema,
    sourceLocationId: InventoryLocationIdSchema,
    destinationLocationId: InventoryLocationIdSchema,
    quantity: PositiveQuantitySchema,
  })
  .refine(
    (value) =>
      value.issueMovementId.toLowerCase() !==
      value.receiptMovementId.toLowerCase(),
    { message: "Movement IDs must differ", path: ["receiptMovementId"] },
  )
  .refine(
    (value) =>
      value.sourceLocationId.toLowerCase() !==
      value.destinationLocationId.toLowerCase(),
    { message: "Locations must differ", path: ["destinationLocationId"] },
  );
export type InventoryTransferDto = z.infer<typeof InventoryTransferSchema>;

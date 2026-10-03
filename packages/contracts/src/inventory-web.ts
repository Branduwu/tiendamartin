import { z } from "zod";
import {
  InventoryLocationSchema,
  InventoryLocationIdSchema,
  InventoryLocationNameSchema,
  InventoryLocationCodeSchema,
} from "./inventory-location";
import {
  ProductIdSchema,
  ProductNameSchema,
  SkuSchema,
} from "./product-fields";
import {
  InventoryAdjustmentReasonSchema,
  InventoryMovementIdSchema,
} from "./inventory-movement";
import { QuantitySchema } from "./quantity";
import { StockBalanceSchema } from "./stock-balance";

export const CreateInventoryLocationSchema = InventoryLocationSchema;
export const InventoryCountSchema = z.strictObject({
  id: InventoryMovementIdSchema,
  productId: ProductIdSchema,
  locationId: InventoryLocationIdSchema,
  counted: QuantitySchema.refine(
    (value) => !value.milliUnits.startsWith("-"),
    "Count must be nonnegative",
  ),
  reason: InventoryAdjustmentReasonSchema,
});
export const InventoryStockSchema = StockBalanceSchema.extend({
  productName: ProductNameSchema,
  sku: SkuSchema,
  locationName: InventoryLocationNameSchema,
  locationCode: InventoryLocationCodeSchema,
});
export type InventoryCountDto = z.infer<typeof InventoryCountSchema>;
export type InventoryStockDto = z.infer<typeof InventoryStockSchema>;

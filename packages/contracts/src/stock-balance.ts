import { z } from "zod";
import { ProductIdSchema } from "./product-fields";
import { InventoryLocationIdSchema } from "./inventory-location";
import { QuantitySchema } from "./quantity";

export const StockBalanceSchema = z.strictObject({
  productId: ProductIdSchema,
  locationId: InventoryLocationIdSchema,
  quantity: QuantitySchema,
});
export type StockBalanceDto = z.infer<typeof StockBalanceSchema>;

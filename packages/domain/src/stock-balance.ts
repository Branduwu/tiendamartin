import { productId, type ProductId } from "./product-fields";
import {
  inventoryLocationId,
  type InventoryLocationId,
} from "./inventory-location";
import { quantity, type Quantity } from "./quantity";

/** Structural state only. Negative balances are representable, not authorized movements. */
export type StockBalance = Readonly<{
  productId: ProductId;
  locationId: InventoryLocationId;
  quantity: Quantity;
}>;

export function stockBalance(input: StockBalance): StockBalance {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid StockBalance input");
  }
  const validatedProductId = productId(input.productId);
  const locationId = inventoryLocationId(input.locationId);
  const original = input.quantity;
  if (!original || typeof original !== "object" || Array.isArray(original)) {
    throw new TypeError("Invalid StockBalance quantity");
  }
  // Independent frozen copy; Quantity owns units, bigint and signed-value rules.
  const value = quantity(original.unit, original.milliUnits);
  return Object.freeze({
    productId: validatedProductId,
    locationId,
    quantity: value,
  });
}

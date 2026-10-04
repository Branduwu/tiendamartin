import { createProduct, type Product } from "./product";
import { productName, sku, barcode } from "./product-fields";
import type { Money } from "./money";
import type { UnitCode } from "./unit";

// Validate the original before replacing a field: commands never repair invalid
// Products by concealing their old value. All results are new frozen snapshots,
// including value-idempotent status changes and removing an absent barcode.
export function renameProduct(product: Product, newName: string): Product {
  const current = createProduct(product);
  return createProduct({ ...current, name: productName(newName) });
}

export function changeProductSku(product: Product, newSku: string): Product {
  const current = createProduct(product);
  return createProduct({ ...current, sku: sku(newSku) });
}

export function changeProductBarcode(
  product: Product,
  newBarcode: string,
): Product {
  const current = createProduct(product);
  return createProduct({ ...current, barcode: barcode(newBarcode) });
}

export function removeProductBarcode(product: Product): Product {
  const current = createProduct(product);
  const copy = { ...current };
  delete copy.barcode;
  return createProduct(copy);
}

/** Changes configuration only; no conversion of prices, quantities or history. */
export function changeProductUnit(
  product: Product,
  newUnit: UnitCode,
): Product {
  const current = createProduct(product);
  return createProduct({ ...current, unit: newUnit });
}

export function changePurchaseCost(product: Product, newCost: Money): Product {
  const current = createProduct(product);
  return createProduct({ ...current, purchaseCost: newCost });
}

export function changeSalePrice(product: Product, newPrice: Money): Product {
  const current = createProduct(product);
  return createProduct({ ...current, salePrice: newPrice });
}

/** Idempotent by value; always returns a new immutable Product. */
export function activateProduct(product: Product): Product {
  const current = createProduct(product);
  return createProduct({ ...current, status: "active" });
}

/** Idempotent by value; always returns a new immutable Product. */
export function deactivateProduct(product: Product): Product {
  const current = createProduct(product);
  return createProduct({ ...current, status: "inactive" });
}

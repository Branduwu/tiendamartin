import {
  createProduct as product,
  productId,
  renameProduct,
  changeProductSku,
  changeProductBarcode,
  removeProductBarcode,
  changeProductUnit,
  changePurchaseCost,
  changeSalePrice,
  activateProduct,
  deactivateProduct,
  type Product,
  type Money,
  type UnitCode,
  type ProductStatus,
} from "@smartretail/domain";

/** Implementations must authorize each method in the persistence transaction. */
export interface ProductRepository {
  listProducts(): Promise<readonly Product[]>;
  createProduct(value: Product): Promise<Product>;
  editProduct(
    id: string,
    change: (current: Product) => Product,
  ): Promise<Product>;
}
export type ProductChanges = Readonly<{
  name?: string;
  sku?: string;
  barcode?: string | null;
  unit?: UnitCode;
  purchaseCost?: Money;
  salePrice?: Money;
  status?: ProductStatus;
}>;
export class ProductNotFoundError extends Error {
  constructor() {
    super("Product not found");
    this.name = "ProductNotFoundError";
  }
}
export function listProducts(repository: ProductRepository) {
  return repository.listProducts();
}
export function createProduct(repository: ProductRepository, input: Product) {
  return repository.createProduct(product(input));
}
export function updateProduct(
  repository: ProductRepository,
  id: string,
  changes: ProductChanges,
) {
  // Snapshot before awaiting persistence: callers cannot change an in-flight command.
  const patch = { ...changes };
  if (patch.purchaseCost)
    patch.purchaseCost = Object.freeze({ ...patch.purchaseCost });
  if (patch.salePrice) patch.salePrice = Object.freeze({ ...patch.salePrice });
  return repository.editProduct(productId(id), (current) => {
    let value = current;
    if (patch.name !== undefined) value = renameProduct(value, patch.name);
    if (patch.sku !== undefined) value = changeProductSku(value, patch.sku);
    if (patch.barcode !== undefined)
      value =
        patch.barcode === null
          ? removeProductBarcode(value)
          : changeProductBarcode(value, patch.barcode);
    if (patch.unit !== undefined) value = changeProductUnit(value, patch.unit);
    if (patch.purchaseCost !== undefined)
      value = changePurchaseCost(value, patch.purchaseCost);
    if (patch.salePrice !== undefined)
      value = changeSalePrice(value, patch.salePrice);
    if (patch.status !== undefined) {
      if (patch.status !== "active" && patch.status !== "inactive")
        throw new TypeError("Invalid status");
      value =
        patch.status === "active"
          ? activateProduct(value)
          : deactivateProduct(value);
    }
    return value;
  });
}

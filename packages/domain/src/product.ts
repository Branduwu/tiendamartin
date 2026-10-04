import { money, type Money } from "./money";
import { assertUnitCode, type UnitCode } from "./unit";
import {
  productId,
  productName,
  sku,
  barcode,
  InvalidProductFieldError,
  type ProductId,
  type ProductName,
  type Sku,
  type Barcode,
  type ProductStatus,
} from "./product-fields";

export type Product = Readonly<{
  id: ProductId;
  name: ProductName;
  sku: Sku;
  barcode?: Barcode;
  taxProfileId?: string;
  unit: UnitCode;
  purchaseCost: Money;
  salePrice: Money;
  status: ProductStatus;
}>;

export type CreateProductInput = Product;

function price(value: Money, field: "purchaseCost" | "salePrice"): Money {
  if (!value) throw new InvalidProductFieldError(field);
  const { currency, minorUnits } = value;
  if (currency !== "MXN" || typeof minorUnits !== "bigint" || minorUnits < 0n) {
    throw new InvalidProductFieldError(field);
  }
  // Copy even structurally valid mutable Money supplied directly by callers.
  return money(minorUnits);
}

export function createProduct(input: CreateProductInput): Product {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidProductFieldError("input");
  }
  const id = productId(input.id);
  const name = productName(input.name);
  const canonicalSku = sku(input.sku);
  const { unit, status } = input;
  assertUnitCode(unit);
  if (status !== "active" && status !== "inactive") {
    throw new InvalidProductFieldError("status");
  }
  return Object.freeze({
    id,
    name,
    sku: canonicalSku,
    ...("barcode" in input ? { barcode: barcode(input.barcode) } : {}),
    ...(input.taxProfileId === undefined
      ? {}
      : { taxProfileId: productId(input.taxProfileId).toLowerCase() }),
    unit,
    purchaseCost: price(input.purchaseCost, "purchaseCost"),
    salePrice: price(input.salePrice, "salePrice"),
    status,
  });
}

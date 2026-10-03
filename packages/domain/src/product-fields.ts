declare const productIdBrand: unique symbol;
declare const productNameBrand: unique symbol;
declare const skuBrand: unique symbol;
declare const barcodeBrand: unique symbol;

export type ProductId = string & { readonly [productIdBrand]: true };
export type ProductName = string & { readonly [productNameBrand]: true };
export type Sku = string & { readonly [skuBrand]: true };
export type Barcode = string & { readonly [barcodeBrand]: true };
export type ProductStatus = "active" | "inactive";

export class InvalidProductFieldError extends TypeError {
  constructor(
    field:
      | "id"
      | "name"
      | "sku"
      | "barcode"
      | "status"
      | "purchaseCost"
      | "salePrice"
      | "input",
  ) {
    super(`Invalid Product ${field}`);
    this.name = "InvalidProductFieldError";
  }
}

// RFC 9562 text form, matching the existing UUID contract (Max is lowercase).
const uuidPattern =
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)(?![\s\S])/;

export function productId(value: string): ProductId {
  if (
    typeof value !== "string" ||
    value.length !== 36 ||
    !uuidPattern.test(value)
  ) {
    throw new InvalidProductFieldError("id");
  }
  return value as ProductId;
}

export function productName(value: string): ProductName {
  // Bound UTF-16 size before counting Unicode code points or inspecting text.
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 240 ||
    [...value].length > 120 ||
    value.trim() !== value ||
    !/[^\p{Cf}\p{M}\p{Z}]/u.test(value) ||
    /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value) ||
    /(?:(?![\u200c\u200d])\p{Cf})/u.test(value)
  ) {
    throw new InvalidProductFieldError("name");
  }
  return value as ProductName;
}

export function sku(value: string): Sku {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    !/^[A-Z0-9](?:[A-Z0-9._-]*[A-Z0-9])?(?![\s\S])/.test(value)
  ) {
    throw new InvalidProductFieldError("sku");
  }
  return value as Sku;
}

export function barcode(value: string): Barcode {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[!-~]+(?![\s\S])/.test(value)
  ) {
    throw new InvalidProductFieldError("barcode");
  }
  return value as Barcode;
}

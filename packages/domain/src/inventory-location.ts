import { productId, productName } from "./product-fields";

declare const locationIdBrand: unique symbol;
declare const locationCodeBrand: unique symbol;
declare const locationNameBrand: unique symbol;
export type InventoryLocationId = string & { readonly [locationIdBrand]: true };
export type InventoryLocationCode = string & {
  readonly [locationCodeBrand]: true;
};
export type InventoryLocationName = string & {
  readonly [locationNameBrand]: true;
};
export type InventoryLocationStatus = "active" | "inactive";

export function inventoryLocationId(value: string): InventoryLocationId {
  // Share the established UUID policy, but never share the nominal identity.
  try {
    productId(value);
  } catch {
    throw new TypeError("Invalid InventoryLocation id");
  }
  return value as InventoryLocationId;
}

export function inventoryLocationCode(value: string): InventoryLocationCode {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 32 ||
    !/^[A-Z0-9](?:[A-Z0-9_-]*[A-Z0-9])?(?![\s\S])/.test(value)
  ) {
    throw new TypeError("Invalid InventoryLocation code");
  }
  return value as InventoryLocationCode;
}

export function inventoryLocationName(value: string): InventoryLocationName {
  // Bound allocation before counting code points; reuse the Unicode policy.
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    [...value].length > 100
  ) {
    throw new TypeError("Invalid InventoryLocation name");
  }
  try {
    productName(value);
  } catch {
    throw new TypeError("Invalid InventoryLocation name");
  }
  return value as InventoryLocationName;
}

export type InventoryLocation = Readonly<{
  id: InventoryLocationId;
  code: InventoryLocationCode;
  name: InventoryLocationName;
  status: InventoryLocationStatus;
}>;

export function createInventoryLocation(
  input: InventoryLocation,
): InventoryLocation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid InventoryLocation input");
  }
  const id = inventoryLocationId(input.id);
  const code = inventoryLocationCode(input.code);
  const name = inventoryLocationName(input.name);
  const { status } = input;
  if (status !== "active" && status !== "inactive") {
    throw new TypeError("Invalid InventoryLocation status");
  }
  return Object.freeze({ id, code, name, status });
}

import {
  productId,
  inventoryLocationId,
  quantity,
  type Quantity,
} from "@smartretail/domain";
export type InventoryState = "normal" | "low" | "out" | "unconfigured";
export type InventoryAlert = Readonly<{
  id: string;
  name: string;
  sku: string;
  locationId: string;
  locationName: string;
  unit: Quantity["unit"];
  stock: string;
  minimum: string;
  suggested: string;
  state: "low" | "out";
}>;
export interface InventoryMinimumRepository {
  setMinimum(
    productId: string,
    locationId: string,
    minimum: Quantity | null,
  ): Promise<void>;
}
/** Validate exact quantities for all callers, not just HTTP. */
export function inventoryMinimum(minimum: Quantity | null): Quantity | null {
  const value =
    minimum === null ? null : quantity(minimum.unit, minimum.milliUnits);
  if (
    value &&
    (value.milliUnits < 0n ||
      value.milliUnits > 9223372036854775807n ||
      (value.unit === "piece" && value.milliUnits % 1000n !== 0n))
  )
    throw new RangeError("Invalid minimum quantity");
  return value;
}
export function setInventoryMinimum(
  repo: InventoryMinimumRepository,
  product: string,
  location: string,
  minimum: Quantity | null,
) {
  return repo.setMinimum(
    productId(product),
    inventoryLocationId(location),
    inventoryMinimum(minimum),
  );
}

import {
  inventoryLocationId,
  createInventoryLocation,
  type InventoryLocation,
  type StockBalance,
} from "@smartretail/domain";
export type InventoryStock = Readonly<{
  balance: StockBalance;
  productName: string;
  sku: string;
  locationName: string;
  locationCode: string;
}>;
/** Each implementation authorizes within its own persistence transaction. */
export interface InventoryQueries {
  listLocations(): Promise<readonly InventoryLocation[]>;
  createLocation(location: InventoryLocation): Promise<InventoryLocation>;
  listStock(locationId?: string): Promise<readonly InventoryStock[]>;
}
export function listInventoryLocations(repository: InventoryQueries) {
  return repository.listLocations();
}
export function createLocation(
  repository: InventoryQueries,
  value: InventoryLocation,
) {
  return repository.createLocation(createInventoryLocation(value));
}
export function listInventoryStock(
  repository: InventoryQueries,
  locationId?: string,
) {
  return repository.listStock(
    locationId === undefined ? undefined : inventoryLocationId(locationId),
  );
}

import {
  createProduct,
  createInventoryLocation,
  stockBalance,
  quantity,
  money,
  productId,
  productName,
  sku,
  barcode,
  inventoryLocationId,
  inventoryLocationCode,
  inventoryLocationName,
  inventoryMovementId,
  inventoryAdjustmentReason,
  createInventoryReceipt,
  createInventoryIssue,
  createInventoryAdjustment,
  inventoryTransferId,
  createInventoryTransfer,
  type UnitCode,
  type ProductStatus,
  type InventoryLocationStatus,
} from "@smartretail/domain";

export function integer(value: string): bigint {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value))
    throw new TypeError(
      "Expected PostgreSQL bigint text; do not override pg bigint parsers",
    );
  return BigInt(value);
}
export function bigintParameter(value: bigint): string {
  if (value < -9223372036854775808n || value > 9223372036854775807n)
    throw new RangeError("Value exceeds PostgreSQL BIGINT storage range");
  return value.toString();
}
export interface BalanceRow {
  product_id: string;
  location_id: string;
  unit: UnitCode;
  milli_units: string;
}
export function balanceFromRow(row: BalanceRow) {
  return stockBalance({
    productId: productId(row.product_id),
    locationId: inventoryLocationId(row.location_id),
    quantity: quantity(row.unit, integer(row.milli_units)),
  });
}
export interface ProductRow {
  tax_profile_id?: string | null;
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: UnitCode;
  currency: string;
  purchase_cost: string;
  sale_price: string;
  status: ProductStatus;
}
export function productFromRow(row: ProductRow) {
  if (row.currency !== "MXN") throw new TypeError("Invalid stored currency");
  return createProduct({
    id: productId(row.id),
    name: productName(row.name),
    sku: sku(row.sku),
    ...(row.barcode === null ? {} : { barcode: barcode(row.barcode) }),
    unit: row.unit,
    purchaseCost: money(integer(row.purchase_cost)),
    salePrice: money(integer(row.sale_price)),
    ...(row.tax_profile_id == null ? {} : { taxProfileId: row.tax_profile_id }),
    status: row.status,
  });
}
export interface LocationRow {
  id: string;
  code: string;
  name: string;
  status: InventoryLocationStatus;
}
export function locationFromRow(row: LocationRow) {
  return createInventoryLocation({
    id: inventoryLocationId(row.id),
    code: inventoryLocationCode(row.code),
    name: inventoryLocationName(row.name),
    status: row.status,
  });
}
export interface MovementRow extends Omit<BalanceRow, "milli_units"> {
  id: string;
  type: "receipt" | "issue" | "adjustment";
  amount: string;
  reason: string | null;
  balance_after: string;
}
export function movementFromRow(row: MovementRow) {
  const target = {
    id: inventoryMovementId(row.id),
    productId: productId(row.product_id),
    locationId: inventoryLocationId(row.location_id),
  };
  const value = quantity(row.unit, integer(row.amount));
  if (row.type === "receipt")
    return createInventoryReceipt({
      ...target,
      type: "receipt",
      quantity: value,
    });
  if (row.type === "issue")
    return createInventoryIssue({ ...target, type: "issue", quantity: value });
  if (row.type !== "adjustment" || row.reason === null)
    throw new TypeError("Invalid stored movement");
  return createInventoryAdjustment({
    ...target,
    type: "adjustment",
    delta: value,
    reason: inventoryAdjustmentReason(row.reason),
  });
}
export interface TransferRow {
  id: string;
  issue_movement_id: string;
  receipt_movement_id: string;
  product_id: string;
  source_location_id: string;
  destination_location_id: string;
  unit: UnitCode;
  milli_units: string;
  source_after: string;
  destination_after: string;
}
export function transferFromRow(row: TransferRow) {
  return createInventoryTransfer({
    id: inventoryTransferId(row.id),
    issueMovementId: inventoryMovementId(row.issue_movement_id),
    receiptMovementId: inventoryMovementId(row.receipt_movement_id),
    productId: productId(row.product_id),
    sourceLocationId: inventoryLocationId(row.source_location_id),
    destinationLocationId: inventoryLocationId(row.destination_location_id),
    quantity: quantity(row.unit, integer(row.milli_units)),
  });
}

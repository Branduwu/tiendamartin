import { productId, type ProductId } from "./product-fields";
import {
  inventoryLocationId,
  type InventoryLocationId,
} from "./inventory-location";
import { stockBalance, type StockBalance } from "./stock-balance";
import type { Quantity } from "./quantity";
import {
  inventoryMovementId,
  createInventoryIssue,
  createInventoryReceipt,
  applyInventoryMovement,
  assertInventoryMovementTarget,
  type InventoryMovementId,
  type InventoryIssue,
  type InventoryReceipt,
} from "./inventory-movement";

declare const transferIdBrand: unique symbol;
export type InventoryTransferId = string & { readonly [transferIdBrand]: true };
export class InvalidInventoryTransferError extends TypeError {
  constructor(field: "id" | "input" | "locations" | "movementIds") {
    super(`Invalid InventoryTransfer ${field}`);
    this.name = "InvalidInventoryTransferError";
  }
}
export function inventoryTransferId(value: string): InventoryTransferId {
  try {
    productId(value);
  } catch {
    throw new InvalidInventoryTransferError("id");
  }
  return value as InventoryTransferId;
}
export type InventoryTransfer = Readonly<{
  id: InventoryTransferId;
  issueMovementId: InventoryMovementId;
  receiptMovementId: InventoryMovementId;
  productId: ProductId;
  sourceLocationId: InventoryLocationId;
  destinationLocationId: InventoryLocationId;
  quantity: Quantity;
}>;
export type InventoryTransferMovements = Readonly<{
  issue: InventoryIssue;
  receipt: InventoryReceipt;
}>;
export type InventoryTransferResult = Readonly<{
  sourceBalance: StockBalance;
  destinationBalance: StockBalance;
}>;

export function createInventoryTransfer(
  input: InventoryTransfer,
): InventoryTransfer {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new InvalidInventoryTransferError("input");
  const id = inventoryTransferId(input.id);
  const issueMovementId = inventoryMovementId(input.issueMovementId);
  const receiptMovementId = inventoryMovementId(input.receiptMovementId);
  const validatedProductId = productId(input.productId);
  const sourceLocationId = inventoryLocationId(input.sourceLocationId);
  const destinationLocationId = inventoryLocationId(
    input.destinationLocationId,
  );
  // UUID casing is preserved; a spelling difference cannot make one UUID two IDs.
  if (issueMovementId.toLowerCase() === receiptMovementId.toLowerCase())
    throw new InvalidInventoryTransferError("movementIds");
  if (sourceLocationId.toLowerCase() === destinationLocationId.toLowerCase())
    throw new InvalidInventoryTransferError("locations");
  const issue = createInventoryIssue({
    id: issueMovementId,
    type: "issue",
    productId: validatedProductId,
    locationId: sourceLocationId,
    quantity: input.quantity,
  });
  return Object.freeze({
    id,
    issueMovementId,
    receiptMovementId,
    productId: validatedProductId,
    sourceLocationId,
    destinationLocationId,
    quantity: issue.quantity,
  });
}

export function createInventoryTransferMovements(
  transfer: InventoryTransfer,
): InventoryTransferMovements {
  const valid = createInventoryTransfer(transfer);
  return Object.freeze({
    issue: createInventoryIssue({
      id: valid.issueMovementId,
      type: "issue",
      productId: valid.productId,
      locationId: valid.sourceLocationId,
      quantity: valid.quantity,
    }),
    receipt: createInventoryReceipt({
      id: valid.receiptMovementId,
      type: "receipt",
      productId: valid.productId,
      locationId: valid.destinationLocationId,
      quantity: valid.quantity,
    }),
  });
}

/** Returns both balances or throws. No durable transaction or deduplication. */
export function applyInventoryTransfer(
  sourceBalance: StockBalance,
  destinationBalance: StockBalance,
  transfer: InventoryTransfer,
): InventoryTransferResult {
  const movements = createInventoryTransferMovements(transfer);
  const source = stockBalance(sourceBalance);
  const destination = stockBalance(destinationBalance);
  // Both relationships are checked before computing either effect.
  assertInventoryMovementTarget(source, movements.issue);
  assertInventoryMovementTarget(destination, movements.receipt);
  const nextSource = applyInventoryMovement(source, movements.issue);
  const nextDestination = applyInventoryMovement(
    destination,
    movements.receipt,
  );
  return Object.freeze({
    sourceBalance: nextSource,
    destinationBalance: nextDestination,
  });
}

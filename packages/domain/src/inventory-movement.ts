import { productId, type ProductId } from "./product-fields";
import {
  inventoryLocationId,
  type InventoryLocationId,
} from "./inventory-location";
import {
  quantity,
  addQuantity,
  subtractQuantity,
  compareQuantity,
  type Quantity,
} from "./quantity";
import { stockBalance, type StockBalance } from "./stock-balance";

declare const movementIdBrand: unique symbol;
declare const adjustmentReasonBrand: unique symbol;
export type InventoryMovementId = string & { readonly [movementIdBrand]: true };
export type InventoryAdjustmentReason = string & {
  readonly [adjustmentReasonBrand]: true;
};
export type InventoryMovementType = "receipt" | "issue" | "adjustment";

export class InvalidInventoryMovementError extends TypeError {
  constructor(
    field: "id" | "type" | "quantity" | "delta" | "reason" | "input",
  ) {
    super(`Invalid InventoryMovement ${field}`);
    this.name = "InvalidInventoryMovementError";
  }
}
export class InventoryMovementTargetMismatchError extends Error {
  constructor() {
    super("InventoryMovement target does not match StockBalance");
    this.name = "InventoryMovementTargetMismatchError";
  }
}
export class InvalidOperationalStockBalanceError extends Error {
  constructor() {
    super("Operational StockBalance must be nonnegative");
    this.name = "InvalidOperationalStockBalanceError";
  }
}
export class InsufficientStockError extends Error {
  constructor() {
    super("InventoryMovement would produce negative stock");
    this.name = "InsufficientStockError";
  }
}

export function inventoryMovementId(value: string): InventoryMovementId {
  try {
    productId(value);
  } catch {
    throw new InvalidInventoryMovementError("id");
  }
  return value as InventoryMovementId;
}

export function inventoryAdjustmentReason(
  value: string,
): InventoryAdjustmentReason {
  // Same visible Unicode policy as ProductName; independent 200-point limit.
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 400 ||
    [...value].length > 200 ||
    value.trim() !== value ||
    !/[^\p{Cf}\p{M}\p{Z}]/u.test(value) ||
    /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value) ||
    /(?:(?![\u200c\u200d])\p{Cf})/u.test(value)
  ) {
    throw new InvalidInventoryMovementError("reason");
  }
  return value as InventoryAdjustmentReason;
}

type MovementTarget = Readonly<{
  id: InventoryMovementId;
  productId: ProductId;
  locationId: InventoryLocationId;
}>;
export type InventoryReceipt = MovementTarget &
  Readonly<{ type: "receipt"; quantity: Quantity }>;
export type InventoryIssue = MovementTarget &
  Readonly<{ type: "issue"; quantity: Quantity }>;
export type InventoryAdjustment = MovementTarget &
  Readonly<{
    type: "adjustment";
    delta: Quantity;
    reason: InventoryAdjustmentReason;
  }>;
export type InventoryMovement =
  InventoryReceipt | InventoryIssue | InventoryAdjustment;

function target(
  input: InventoryMovement,
  expected: InventoryMovementType,
): MovementTarget {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new InvalidInventoryMovementError("input");
  if (input.type !== expected) throw new InvalidInventoryMovementError("type");
  return {
    id: inventoryMovementId(input.id),
    productId: productId(input.productId),
    locationId: inventoryLocationId(input.locationId),
  };
}
function movementQuantity(
  value: Quantity,
  field: "quantity" | "delta",
): Quantity {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InvalidInventoryMovementError(field);
  const result = quantity(value.unit, value.milliUnits);
  if (field === "quantity" ? result.milliUnits <= 0n : result.milliUnits === 0n)
    throw new InvalidInventoryMovementError(field);
  return result;
}

export function createInventoryReceipt(
  input: InventoryReceipt,
): InventoryReceipt {
  const ids = target(input, "receipt");
  return Object.freeze({
    ...ids,
    type: "receipt",
    quantity: movementQuantity(input.quantity, "quantity"),
  });
}
export function createInventoryIssue(input: InventoryIssue): InventoryIssue {
  const ids = target(input, "issue");
  return Object.freeze({
    ...ids,
    type: "issue",
    quantity: movementQuantity(input.quantity, "quantity"),
  });
}
export function createInventoryAdjustment(
  input: InventoryAdjustment,
): InventoryAdjustment {
  const ids = target(input, "adjustment");
  return Object.freeze({
    ...ids,
    type: "adjustment",
    delta: movementQuantity(input.delta, "delta"),
    reason: inventoryAdjustmentReason(input.reason),
  });
}

function validatedMovement(input: InventoryMovement): InventoryMovement {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new InvalidInventoryMovementError("input");
  switch (input.type) {
    case "receipt":
      return createInventoryReceipt(input);
    case "issue":
      return createInventoryIssue(input);
    case "adjustment":
      return createInventoryAdjustment(input);
    default:
      throw new InvalidInventoryMovementError("type");
  }
}

// Internal preflight shared with transfer orchestration; not a package export.
export function assertInventoryMovementTarget(
  balance: StockBalance,
  movement: InventoryMovement,
): void {
  if (
    balance.productId !== movement.productId ||
    balance.locationId !== movement.locationId
  ) {
    throw new InventoryMovementTargetMismatchError();
  }
  compareQuantity(
    balance.quantity,
    movement.type === "adjustment" ? movement.delta : movement.quantity,
  );
}

/** Pure application, NOT deduplication: applying the same ID again applies it again. */
export function applyInventoryMovement(
  balance: StockBalance,
  movement: InventoryMovement,
): StockBalance {
  const current = stockBalance(balance);
  if (current.quantity.milliUnits < 0n)
    throw new InvalidOperationalStockBalanceError();
  const valid = validatedMovement(movement);
  assertInventoryMovementTarget(current, valid);
  // Quantity operations enforce exact unit equality and exact bigint arithmetic.
  const next =
    valid.type === "issue"
      ? subtractQuantity(current.quantity, valid.quantity)
      : addQuantity(
          current.quantity,
          valid.type === "receipt" ? valid.quantity : valid.delta,
        );
  if (next.milliUnits < 0n) throw new InsufficientStockError();
  return stockBalance({
    productId: current.productId,
    locationId: current.locationId,
    quantity: next,
  });
}

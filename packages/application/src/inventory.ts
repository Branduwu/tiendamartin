import {
  createInventoryReceipt,
  createInventoryIssue,
  createInventoryAdjustment,
  createInventoryTransfer,
  createInventoryTransferMovements,
  applyInventoryMovement,
  applyInventoryTransfer,
  stockBalance,
  subtractQuantity,
  isZeroQuantity,
  inventoryMovementId,
  inventoryAdjustmentReason,
  InventoryMovementTargetMismatchError,
  type InventoryReceipt,
  type InventoryIssue,
  type InventoryAdjustment,
  type InventoryMovement,
  type InventoryTransfer,
  type InventoryTransferResult,
  type InventoryMovementId,
  type InventoryAdjustmentReason,
  type StockBalance,
  type Quantity,
} from "@smartretail/domain";
import type {
  InventoryUnitOfWork,
  InventoryTransaction,
  StockTarget,
} from "./ports";
import {
  assertSameInstruction,
  InventoryIdempotencyConflictError,
} from "./replay";

export class StockBalanceNotFoundError extends Error {
  constructor() {
    super("StockBalance not found");
    this.name = "StockBalanceNotFoundError";
  }
}

export class InvalidInventoryCountError extends TypeError {
  constructor() {
    super("Inventory count must be nonnegative");
    this.name = "InvalidInventoryCountError";
  }
}

function target(value: StockTarget): StockTarget {
  return Object.freeze({
    productId: value.productId,
    locationId: value.locationId,
  });
}

async function readBalance(
  tx: InventoryTransaction,
  key: StockTarget,
): Promise<StockBalance> {
  const found = await tx.readBalance(key);
  if (found === undefined) throw new StockBalanceNotFoundError();
  const balance = stockBalance(found);
  if (
    balance.productId !== key.productId ||
    balance.locationId !== key.locationId
  )
    throw new InventoryMovementTargetMismatchError();
  return balance;
}

export type InventoryMovementResult = Readonly<{
  balance: StockBalance;
  movement: InventoryMovement;
}>;

function applyMovement(
  uow: InventoryUnitOfWork,
  movement: InventoryMovement,
): Promise<InventoryMovementResult> {
  const key = target(movement);
  return uow.run(
    Object.freeze([key]),
    async (tx) => {
      await tx.reserveCommand?.(movement.id, movement.type);
      const prior = await tx.findMovement?.(movement.id);
      if (prior) {
        assertSameInstruction(prior.movement, movement);
        return Object.freeze({
          balance: prior.balance,
          movement: prior.movement,
        });
      }
      const current = await readBalance(tx, key);
      const balance = applyInventoryMovement(current, movement);
      await tx.appendMovement(movement);
      await tx.saveBalance(balance);
      return Object.freeze({ balance, movement });
    },
    movement.type === "receipt"
      ? "inventory.receive"
      : movement.type === "issue"
        ? "inventory.issue"
        : "inventory.adjust",
  );
}

export async function receiveInventory(
  uow: InventoryUnitOfWork,
  input: InventoryReceipt,
): Promise<InventoryMovementResult> {
  return applyMovement(uow, createInventoryReceipt(input));
}

export async function issueInventory(
  uow: InventoryUnitOfWork,
  input: InventoryIssue,
): Promise<InventoryMovementResult> {
  return applyMovement(uow, createInventoryIssue(input));
}

export async function adjustInventory(
  uow: InventoryUnitOfWork,
  input: InventoryAdjustment,
): Promise<InventoryMovementResult> {
  return applyMovement(uow, createInventoryAdjustment(input));
}

export async function transferInventory(
  uow: InventoryUnitOfWork,
  input: InventoryTransfer,
): Promise<InventoryTransferResult> {
  const transfer = createInventoryTransfer(input);
  const source = target({
    productId: transfer.productId,
    locationId: transfer.sourceLocationId,
  });
  const destination = target({
    productId: transfer.productId,
    locationId: transfer.destinationLocationId,
  });
  return uow.run(
    Object.freeze([source, destination]),
    async (tx) => {
      const prior = await tx.findTransfer?.(transfer.id);
      if (prior) {
        assertSameInstruction(prior.transfer, transfer);
        return prior.result;
      }
      const sourceBalance = await readBalance(tx, source);
      const destinationBalance = await readBalance(tx, destination);
      const result = applyInventoryTransfer(
        sourceBalance,
        destinationBalance,
        transfer,
      );
      const movements = createInventoryTransferMovements(transfer);
      await tx.appendTransfer(transfer);
      await tx.appendMovement(movements.issue);
      await tx.appendMovement(movements.receipt);
      await tx.saveBalance(result.sourceBalance);
      await tx.saveBalance(result.destinationBalance);
      return result;
    },
    "inventory.transfer",
  );
}

export type ReconcileInventoryInput = StockTarget &
  Readonly<{
    id: InventoryMovementId;
    counted: Quantity;
    reason: InventoryAdjustmentReason;
  }>;
export type InventoryReconciliationResult =
  | Readonly<{ status: "no-change"; balance: StockBalance }>
  | Readonly<{
      status: "adjusted";
      balance: StockBalance;
      movement: InventoryAdjustment;
    }>;

export async function reconcileInventory(
  uow: InventoryUnitOfWork,
  input: ReconcileInventoryInput,
): Promise<InventoryReconciliationResult> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Invalid inventory count input");
  // Snapshot and validate even on the no-change path, before the first await.
  const counted = stockBalance({
    productId: input.productId,
    locationId: input.locationId,
    quantity: input.counted,
  });
  const id = inventoryMovementId(input.id);
  const reason = inventoryAdjustmentReason(input.reason);
  if (counted.quantity.milliUnits < 0n) throw new InvalidInventoryCountError();
  const key = target(counted);
  return uow.run(
    Object.freeze([key]),
    async (tx) => {
      await tx.reserveCommand?.(id, "count");
      const recorded = await tx.findReconciliation?.(id);
      if (recorded) {
        const prior = recorded.input;
        if (
          prior.productId.toLowerCase() !== key.productId.toLowerCase() ||
          prior.locationId.toLowerCase() !== key.locationId.toLowerCase() ||
          prior.counted.unit !== counted.quantity.unit ||
          prior.counted.milliUnits !== counted.quantity.milliUnits ||
          prior.reason !== reason
        )
          throw new InventoryIdempotencyConflictError();
        return recorded.result;
      }
      // Durable count receipts identify the command kind; an independent
      // adjustment is never interpreted as an earlier count in production.
      const prior = tx.findReconciliation
        ? undefined
        : await tx.findMovement?.(id);
      if (prior) {
        if (
          prior.movement.type !== "adjustment" ||
          prior.movement.reason !== reason ||
          prior.balance.productId.toLowerCase() !==
            key.productId.toLowerCase() ||
          prior.balance.locationId.toLowerCase() !==
            key.locationId.toLowerCase() ||
          prior.balance.quantity.unit !== counted.quantity.unit ||
          prior.balance.quantity.milliUnits !== counted.quantity.milliUnits
        )
          throw new InventoryIdempotencyConflictError();
        return Object.freeze({
          status: "adjusted",
          balance: prior.balance,
          movement: prior.movement,
        });
      }
      const current = await readBalance(tx, key);
      const delta = subtractQuantity(counted.quantity, current.quantity);
      const command = { ...key, id, counted: counted.quantity, reason };
      if (isZeroQuantity(delta)) {
        const result = Object.freeze({
          status: "no-change" as const,
          balance: current,
        });
        await tx.saveReconciliation?.(command, result);
        return result;
      }
      const movement = createInventoryAdjustment({
        ...key,
        id,
        type: "adjustment",
        delta,
        reason,
      });
      const balance = applyInventoryMovement(current, movement);
      await tx.appendMovement(movement);
      await tx.saveBalance(balance);
      const result = Object.freeze({
        status: "adjusted" as const,
        balance,
        movement,
      });
      await tx.saveReconciliation?.(command, result);
      return result;
    },
    "inventory.adjust",
  );
}

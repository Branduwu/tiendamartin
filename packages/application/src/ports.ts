import type {
  ProductId,
  InventoryLocationId,
  StockBalance,
  InventoryMovement,
  InventoryTransfer,
  InventoryMovementId,
  InventoryTransferId,
  InventoryTransferResult,
} from "@smartretail/domain";
import type { Permission } from "./authorization";
import type {
  ReconcileInventoryInput,
  InventoryReconciliationResult,
} from "./inventory";

export type StockTarget = Readonly<{
  productId: ProductId;
  locationId: InventoryLocationId;
}>;

/** Transaction-scoped ports, never independent auto-committing repositories. */
export interface InventoryTransaction {
  /** Atomic identity reservation shared by counts and ledger movements. */
  reserveCommand?(
    id: InventoryMovementId,
    kind: InventoryMovement["type"] | "count",
  ): Promise<void>;
  /** Durable command receipts include no-change counts, without ledger noise. */
  findReconciliation?(id: InventoryMovementId): Promise<
    | Readonly<{
        input: ReconcileInventoryInput;
        result: InventoryReconciliationResult;
      }>
    | undefined
  >;
  saveReconciliation?(
    input: ReconcileInventoryInput,
    result: InventoryReconciliationResult,
  ): Promise<void>;
  /** Optional durable replay capability; legacy adapters may only reject duplicates. */
  findMovement?(
    id: InventoryMovementId,
  ): Promise<
    Readonly<{ movement: InventoryMovement; balance: StockBalance }> | undefined
  >;
  findTransfer?(
    id: InventoryTransferId,
  ): Promise<
    | Readonly<{ transfer: InventoryTransfer; result: InventoryTransferResult }>
    | undefined
  >;
  readBalance(target: StockTarget): Promise<StockBalance | undefined>;
  /** Persist only a balance derived from its ledger movement in this transaction. */
  saveBalance(balance: StockBalance): Promise<void>;
  /** Append-only; duplicates not handled by replay must fail, never overwrite. */
  appendMovement(movement: InventoryMovement): Promise<void>;
  /** Append-only; the adapter must reject reused transfer IDs. */
  appendTransfer(transfer: InventoryTransfer): Promise<void>;
}

export interface InventoryUnitOfWork {
  /**
   * Adapter contract: acquire all target locks in a stable order before reading;
   * commit ledger, transfer and balances together before resolving. Any failure
   * must roll everything back. Callback runs once; do not silently retry it.
   * PostgreSQL must supply transactions, concurrency control and unique IDs.
   * This interface alone provides no durable atomicity or exactly-once guarantee.
   * Verify valid identity, active membership and permission before calling work,
   * in the same transaction. No optional or permissive authorization fallback.
   */
  run<T>(
    targets: readonly StockTarget[],
    work: (transaction: InventoryTransaction) => Promise<T>,
    permission: Permission,
  ): Promise<T>;
}

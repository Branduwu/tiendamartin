import {
  completeSale,
  createSaleDraft,
  addSaleProduct,
  salePayments,
  saleId,
  inventoryLocationId,
  inventoryMovementId,
  productId,
  createInventoryIssue,
  applyInventoryMovement,
  type SaleDraft,
  type CompletedSale,
  type SalePayment,
  type Product,
  type InventoryLocation,
  type StockBalance,
  type InventoryIssue,
} from "@smartretail/domain";
import { CustomerUnavailableError } from "./customers";
import { StockBalanceNotFoundError } from "./inventory";
import { SuspensionConflictError } from "./suspended-sales";
import { ProductNotFoundError } from "./products";

export type SaleCheckoutInput = Readonly<{
  shiftId?: string;
  suspendedSaleId?: string;
  draft: SaleDraft;
  locationId: string;
  payments: readonly SalePayment[];
  movements: readonly Readonly<{ productId: string; movementId: string }>[];
}>;
export type StoredSale = Readonly<{
  shiftId: string | null;
  customerName?: string;
  sale: CompletedSale;
  payments: readonly SalePayment[];
  locationId: string;
  tenantId: string;
  createdBy: string;
  createdByName?: string;
  locationName?: string;
  createdAt: string;
}>;
export type SaleCheckoutResult = Readonly<{
  recorded: StoredSale;
  replayed: boolean;
}>;
export class SaleIdempotencyConflictError extends Error {}
export class SaleQuoteChangedError extends Error {}
export class SaleNotFoundError extends Error {}

export interface SaleTransaction {
  findRecorded(): Promise<
    Readonly<{ payload: string; recorded: StoredSale }> | undefined
  >;
  lockSuspendedSale?(id: string, locationId: string): Promise<void>;
  validateCustomer?(id: string): Promise<void>;
  lockOpenShift(locationId: string, shiftId: string | undefined): Promise<void>;
  readProduct(id: string): Promise<Product | undefined>;
  readLocation(id: string): Promise<InventoryLocation | undefined>;
  lockBalances(
    productIds: readonly string[],
    locationId: string,
  ): Promise<void>;
  readBalance(productId: string, locationId: string): Promise<StockBalance>;
  appendIssue(issue: InventoryIssue, balance: StockBalance): Promise<void>;
  persistSale(
    sale: CompletedSale,
    input: SaleCheckoutInput,
    payload: string,
  ): Promise<StoredSale>;
}
export interface SaleUnitOfWork {
  /** Authenticate/authorize sales.create and serialize this SaleId before work.
   * All reads, ordered locks, ledger and sale writes share ONE SQL transaction. */
  runSale<T>(id: string, work: (tx: SaleTransaction) => Promise<T>): Promise<T>;
  readSale(id: string): Promise<StoredSale>;
}

export function saleCommand(input: SaleCheckoutInput) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Invalid checkout");
  const validated = completeSale(input.draft);
  const draft: SaleDraft = Object.freeze({ ...validated, status: "draft" });
  const payments = salePayments(input.payments, draft.total);
  const locationId = inventoryLocationId(input.locationId).toLowerCase();
  if (
    !Array.isArray(input.movements) ||
    input.movements.length !== draft.lines.length
  )
    throw new TypeError("Every sale line needs one stable movement ID");
  const movements = input.movements
    .map((m) =>
      Object.freeze({
        productId: productId(m.productId).toLowerCase(),
        movementId: inventoryMovementId(m.movementId).toLowerCase(),
      }),
    )
    .sort((a, b) => a.productId.localeCompare(b.productId));
  if (
    new Set(movements.map((m) => m.productId)).size !== movements.length ||
    new Set(movements.map((m) => m.movementId)).size !== movements.length ||
    draft.lines.some(
      (l) => !movements.some((m) => m.productId === l.productId.toLowerCase()),
    )
  )
    throw new TypeError("Invalid movement mapping");
  const snapshot = Object.freeze({
    ...(input.shiftId === undefined
      ? {}
      : { shiftId: productId(input.shiftId).toLowerCase() }),
    ...(input.suspendedSaleId === undefined
      ? {}
      : { suspendedSaleId: saleId(input.suspendedSaleId) }),
    draft,
    locationId,
    payments,
    movements: Object.freeze(movements),
  });
  const canonicalLines = [...draft.lines]
    .sort((a, b) => a.productId.localeCompare(b.productId))
    .map((l) => ({
      productId: l.productId.toLowerCase(),
      sku: l.sku,
      name: l.name,
      unit: l.unit,
      quantity: l.quantity.milliUnits.toString(),
      unitPrice: l.unitPrice.minorUnits.toString(),
      lineTotal: l.lineTotal.minorUnits.toString(),
    }));
  const payload = JSON.stringify({
    ...(snapshot.shiftId === undefined ? {} : { shiftId: snapshot.shiftId }),
    ...(snapshot.suspendedSaleId === undefined
      ? {}
      : { suspendedSaleId: snapshot.suspendedSaleId }),
    id: draft.id,
    ...(draft.customerId === undefined ? {} : { customerId: draft.customerId }),
    locationId,
    lines: canonicalLines,
    total: draft.total.minorUnits.toString(),
    payments: [...payments]
      .sort((a, b) => a.method.localeCompare(b.method))
      .map((p) => ({
        method: p.method,
        amount: p.amount.minorUnits.toString(),
      })),
    movements,
  });
  return { snapshot, payload };
}

export async function completeSaleTransaction(
  uow: SaleUnitOfWork,
  input: SaleCheckoutInput,
): Promise<SaleCheckoutResult> {
  const { snapshot, payload } = saleCommand(input);
  return uow.runSale(snapshot.draft.id, async (tx) => {
    const prior = await tx.findRecorded();
    if (prior) {
      if (prior.payload !== payload) throw new SaleIdempotencyConflictError();
      return Object.freeze({ recorded: prior.recorded, replayed: true });
    }
    if (snapshot.draft.customerId !== undefined) {
      if (!tx.validateCustomer) throw new CustomerUnavailableError();
      await tx.validateCustomer(snapshot.draft.customerId);
    }
    const location = await tx.readLocation(snapshot.locationId);
    if (!location || location.status !== "active")
      throw new StockBalanceNotFoundError();
    if (snapshot.suspendedSaleId !== undefined) {
      if (!tx.lockSuspendedSale) throw new SuspensionConflictError();
      await tx.lockSuspendedSale(snapshot.suspendedSaleId, snapshot.locationId);
    }
    await tx.lockOpenShift(snapshot.locationId, snapshot.shiftId);
    let trusted = createSaleDraft(snapshot.draft.id, snapshot.draft.customerId);
    const lines = [...snapshot.draft.lines].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    );
    for (const line of lines) {
      const product = await tx.readProduct(line.productId);
      if (!product) throw new ProductNotFoundError();
      trusted = addSaleProduct(trusted, product, line.quantity);
      const rebuilt = trusted.lines.find((l) => l.productId === line.productId);
      if (
        !rebuilt ||
        rebuilt.name !== line.name ||
        rebuilt.sku !== line.sku ||
        rebuilt.unitPrice.minorUnits !== line.unitPrice.minorUnits ||
        rebuilt.lineTotal.minorUnits !== line.lineTotal.minorUnits
      )
        throw new SaleQuoteChangedError();
    }
    const completed = completeSale(trusted);
    salePayments(snapshot.payments, completed.total);
    await tx.lockBalances(
      lines.map((l) => l.productId),
      snapshot.locationId,
    );
    for (const line of completed.lines) {
      const mapping = snapshot.movements.find(
        (m) => m.productId === line.productId,
      );
      if (!mapping) throw new TypeError("Missing stable movement ID");
      const movement = createInventoryIssue({
        id: inventoryMovementId(mapping.movementId),
        productId: line.productId,
        locationId: inventoryLocationId(snapshot.locationId),
        type: "issue",
        quantity: line.quantity,
      });
      const balance = applyInventoryMovement(
        await tx.readBalance(line.productId, snapshot.locationId),
        movement,
      );
      await tx.appendIssue(movement, balance);
    }
    return Object.freeze({
      recorded: await tx.persistSale(completed, snapshot, payload),
      replayed: false,
    });
  });
}
export function readSale(repository: SaleUnitOfWork, id: string) {
  return repository.readSale(saleId(id));
}

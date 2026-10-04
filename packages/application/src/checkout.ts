import { taxRate, type TaxExpectation } from "@smartretail/domain";
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
  type DiscountIntent,
  type DiscountDetails,
  discount,
  couponCode,
} from "@smartretail/domain";
import { CustomerUnavailableError } from "./customers";
import { CreditUnavailableError } from "@smartretail/domain";
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
  discounts?: DiscountIntent;
  taxes?: readonly TaxExpectation[];
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
  details?: DiscountDetails;
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
  priceSale?(
    sale: CompletedSale,
    input: SaleCheckoutInput,
    quote?: boolean,
  ): Promise<Readonly<{ sale: CompletedSale; details?: DiscountDetails }>>;
  lockSuspendedSale?(id: string, locationId: string): Promise<void>;
  validateCustomer?(id: string): Promise<void>;
  validateCredit?(id: string, amount: bigint): Promise<void>;
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
    details?: DiscountDetails,
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
  if (draft.lines.some((l) => l.discount !== undefined || l.tax !== undefined))
    throw new TypeError("Client discounts belong to intent, not paid lines");
  const discounts =
    input.discounts === undefined
      ? undefined
      : Object.freeze({
          ...(input.discounts.sale === undefined
            ? {}
            : {
                sale: discount(
                  input.discounts.sale.type,
                  input.discounts.sale.value,
                ),
              }),
          ...(input.discounts.lines === undefined
            ? {}
            : {
                lines: Object.freeze(
                  input.discounts.lines
                    .map((l) =>
                      Object.freeze({
                        productId: productId(l.productId).toLowerCase(),
                        discount: discount(l.discount.type, l.discount.value),
                      }),
                    )
                    .sort((a, b) => a.productId.localeCompare(b.productId)),
                ),
              }),
          ...(input.discounts.couponCode === undefined
            ? {}
            : { couponCode: couponCode(input.discounts.couponCode) }),
        });
  const payments = salePayments(input.payments, {
    currency: "MXN",
    minorUnits: input.payments.reduce(
      (sum, p) => sum + p.amount.minorUnits,
      0n,
    ),
  });
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
  const taxes = input.taxes
    ?.map((t) =>
      Object.freeze({
        productId: productId(t.productId).toLowerCase(),
        profileId: productId(t.profileId).toLowerCase(),
        rate: taxRate(t.rate),
      }),
    )
    .sort((a, b) => a.productId.localeCompare(b.productId));
  if (
    taxes &&
    (new Set(taxes.map((t) => t.productId)).size !== taxes.length ||
      taxes.some((t) => !draft.lines.some((l) => l.productId === t.productId)))
  )
    throw new TypeError("Invalid tax expectations");
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
    ...(discounts === undefined ? {} : { discounts }),
    ...(taxes === undefined ? {} : { taxes: Object.freeze(taxes) }),
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
    ...(taxes === undefined
      ? {}
      : { taxes: taxes.map((t) => ({ ...t, rate: t.rate.toString() })) }),
    ...(discounts === undefined
      ? {}
      : {
          discounts: {
            ...(discounts.sale === undefined
              ? {}
              : {
                  sale: {
                    type: discounts.sale.type,
                    value: discounts.sale.value.toString(),
                  },
                }),
            ...(discounts.lines === undefined
              ? {}
              : {
                  lines: discounts.lines.map((l) => ({
                    productId: l.productId,
                    discount: {
                      type: l.discount.type,
                      value: l.discount.value.toString(),
                    },
                  })),
                }),
            ...(discounts.couponCode === undefined
              ? {}
              : { couponCode: discounts.couponCode }),
          },
        }),
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
    const credit =
      snapshot.payments.find((p) => p.method === "credit")?.amount.minorUnits ??
      0n;
    if (credit > 0n) {
      if (!snapshot.draft.customerId || !tx.validateCredit)
        throw new CreditUnavailableError();
      await tx.validateCredit(snapshot.draft.customerId, credit);
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
    let requiresTaxPricing = false;
    for (const line of lines) {
      const product = await tx.readProduct(line.productId);
      if (!product) throw new ProductNotFoundError();
      requiresTaxPricing ||= product.taxProfileId !== undefined;
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
    if (
      (snapshot.discounts !== undefined ||
        snapshot.taxes !== undefined ||
        requiresTaxPricing) &&
      !tx.priceSale
    )
      throw new TypeError("Discount-aware transaction required");
    const priced = tx.priceSale
      ? await tx.priceSale(completeSale(trusted), snapshot)
      : { sale: completeSale(trusted) };
    const completed = priced.sale;
    if (
      snapshot.payments.reduce((s, p) => s + p.amount.minorUnits, 0n) !==
      completed.total.minorUnits
    )
      throw new SaleQuoteChangedError();
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
      recorded: await tx.persistSale(
        completed,
        snapshot,
        payload,
        "details" in priced ? priced.details : undefined,
      ),
      replayed: false,
    });
  });
}
export function readSale(repository: SaleUnitOfWork, id: string) {
  return repository.readSale(saleId(id));
}

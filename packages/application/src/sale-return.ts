import {
  saleReturnId,
  productId,
  quantity,
  type SaleReturn,
  type ReturnSelection,
  type SalePayment,
} from "@smartretail/domain";
export type SaleReturnInput = Readonly<{
  id: string;
  correlationId?: string;
  shiftId?: string;
  cashMovementId?: string;
  lines: readonly (ReturnSelection & Readonly<{ movementId: string }>)[];
  refunds: readonly SalePayment[];
}>;
export type StoredSaleReturn = SaleReturn &
  Readonly<{
    tenantId: string;
    locationId: string;
    createdBy: string;
    createdAt: string;
    shiftId: string | null;
    cashMovementId: string | null;
  }>;
export interface SaleReturnRepository {
  returnSale(
    saleId: string,
    input: SaleReturnInput,
  ): Promise<Readonly<{ record: StoredSaleReturn; replayed: boolean }>>;
  listReturns(saleId: string): Promise<readonly StoredSaleReturn[]>;
}
export function returnCommand(sid: string, input: SaleReturnInput) {
  const lines = input.lines
    .map((l) =>
      Object.freeze({
        saleLineId: productId(l.saleLineId).toLowerCase(),
        productId: productId(l.productId).toLowerCase(),
        quantity: quantity(l.quantity.unit, l.quantity.milliUnits),
        movementId: productId(l.movementId).toLowerCase(),
      }),
    )
    .sort((a, b) => a.productId.localeCompare(b.productId));
  const snapshot = Object.freeze({
    ...input,
    id: saleReturnId(input.id),
    ...(input.shiftId === undefined
      ? {}
      : { shiftId: productId(input.shiftId).toLowerCase() }),
    ...(input.cashMovementId === undefined
      ? {}
      : { cashMovementId: productId(input.cashMovementId).toLowerCase() }),
    lines: Object.freeze(lines),
    refunds: Object.freeze(
      input.refunds.map((p) =>
        Object.freeze({ ...p, amount: Object.freeze({ ...p.amount }) }),
      ),
    ),
  });
  if (
    !lines.length ||
    lines.length > 1000 ||
    new Set(lines.map((l) => l.productId)).size !== lines.length ||
    new Set(lines.map((l) => l.movementId)).size !== lines.length ||
    (snapshot.cashMovementId &&
      lines.some((l) => l.movementId === snapshot.cashMovementId))
  )
    throw new TypeError("Invalid return mapping");
  const payload = JSON.stringify({
    saleId: productId(sid).toLowerCase(),
    id: snapshot.id,
    shiftId: snapshot.shiftId ?? null,
    cashMovementId: snapshot.cashMovementId ?? null,
    lines: lines.map((l) => ({
      ...l,
      quantity: {
        unit: l.quantity.unit,
        milliUnits: l.quantity.milliUnits.toString(),
      },
    })),
    refunds: [...snapshot.refunds]
      .sort((a, b) => a.method.localeCompare(b.method))
      .map((p) => ({
        method: p.method,
        amount: p.amount.minorUnits.toString(),
      })),
  });
  return { snapshot, payload };
}

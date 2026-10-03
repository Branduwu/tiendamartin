import {
  saleId,
  completeSale,
  calculateSaleLineTotal,
  type CompletedSale,
} from "./sale";
import { productId, type ProductId } from "./product-fields";
import { quantity, type Quantity } from "./quantity";
import { money, type Money } from "./money";
import { salePayments, type SalePayment } from "./sale-payment";
declare const returnBrand: unique symbol;
export type SaleReturnId = string & { readonly [returnBrand]: true };
export function saleReturnId(value: string): SaleReturnId {
  return saleId(value) as string as SaleReturnId;
}
/** Existing lines are identified by (saleId,productId), not a new historical UUID.
 * saleLineId is the product UUID scoped by the original sale. */
export type SaleReturnLine = Readonly<{
  saleLineId: ProductId;
  productId: ProductId;
  quantity: Quantity;
  refunded: Money;
}>;
export type SaleReturn = Readonly<{
  id: SaleReturnId;
  saleId: string;
  status: "completed";
  lines: readonly SaleReturnLine[];
  total: Money;
  refunds: readonly SalePayment[];
}>;
export class SaleReturnConflictError extends Error {}
export type ReturnSelection = Readonly<{
  saleLineId: string;
  productId: string;
  quantity: Quantity;
}>;
export function returnedLineAmount(
  price: Money,
  prior: Quantity,
  next: Quantity,
): Money {
  if (
    prior.unit !== next.unit ||
    prior.milliUnits < 0n ||
    next.milliUnits <= 0n
  )
    throw new TypeError("Invalid return quantity");
  // Cumulative HALF-UP allocation conserves original cents across partial returns.
  const before =
    prior.milliUnits === 0n ? money(0n) : calculateSaleLineTotal(price, prior);
  const after = calculateSaleLineTotal(
    price,
    quantity(next.unit, prior.milliUnits + next.milliUnits),
  );
  return money(after.minorUnits - before.minorUnits);
}
export function quoteSaleReturn(
  original: CompletedSale,
  selections: readonly ReturnSelection[],
  previous: readonly SaleReturn[],
) {
  if (original.status !== "completed")
    throw new TypeError("Completed original sale required");
  const sale = completeSale({ ...original, status: "draft" });
  if (
    !Array.isArray(selections) ||
    !selections.length ||
    selections.length > 1000
  )
    throw new TypeError("Select return lines");
  const seen = new Set<string>();
  const lines = selections.map((input) => {
    const pid = productId(input.productId).toLowerCase(),
      lineId = productId(input.saleLineId).toLowerCase();
    if (pid !== lineId || seen.has(pid))
      throw new TypeError("Invalid sale line identity");
    seen.add(pid);
    const source = sale.lines.find((l) => l.productId === pid);
    if (!source) throw new SaleReturnConflictError("Line not in original sale");
    const amount = quantity(input.quantity.unit, input.quantity.milliUnits);
    if (
      amount.unit !== source.unit ||
      amount.milliUnits <= 0n ||
      (amount.unit === "piece" && amount.milliUnits % 1000n !== 0n)
    )
      throw new TypeError("Invalid return quantity");
    let returned = 0n;
    for (const prior of previous) {
      if (prior.saleId !== sale.id)
        throw new TypeError("Return belongs to another sale");
      for (const l of prior.lines)
        if (l.productId === pid) returned += l.quantity.milliUnits;
    }
    if (returned + amount.milliUnits > source.quantity.milliUnits)
      throw new SaleReturnConflictError("Quantity already returned");
    return Object.freeze({
      saleLineId: productId(lineId),
      productId: productId(pid),
      quantity: amount,
      refunded: returnedLineAmount(
        source.unitPrice,
        quantity(source.unit, returned),
        amount,
      ),
    });
  });
  const total = money(
    lines.reduce((sum, l) => sum + l.refunded.minorUnits, 0n),
  );
  return Object.freeze({ lines: Object.freeze(lines), total });
}
export function createSaleReturn(
  id: string,
  original: CompletedSale,
  selections: readonly ReturnSelection[],
  previous: readonly SaleReturn[],
  refunds: readonly SalePayment[],
): SaleReturn {
  const quote = quoteSaleReturn(original, selections, previous);
  const payments = salePayments(refunds, quote.total);
  return Object.freeze({
    id: saleReturnId(id),
    saleId: saleId(original.id),
    status: "completed",
    ...quote,
    refunds: payments,
  });
}
export function assertRefundLimits(
  original: readonly SalePayment[],
  previous: readonly SaleReturn[],
  requested: readonly SalePayment[],
): void {
  for (const method of ["cash", "card"] as const) {
    const paid =
      original.find((p) => p.method === method)?.amount.minorUnits ?? 0n;
    const refunded = previous.reduce(
      (sum, r) =>
        sum +
        (r.refunds.find((p) => p.method === method)?.amount.minorUnits ?? 0n),
      0n,
    );
    const next =
      requested.find((p) => p.method === method)?.amount.minorUnits ?? 0n;
    if (refunded + next > paid)
      throw new SaleReturnConflictError(
        "Refund exceeds original payment method",
      );
  }
}

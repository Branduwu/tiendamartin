import { money, type Money } from "./money";
export class CreditUnavailableError extends Error {}
export class ReceivableConflictError extends Error {}
export function receivableState(original: Money, paid: Money, returned: Money) {
  for (const value of [original, paid, returned])
    if (
      value.currency !== "MXN" ||
      typeof value.minorUnits !== "bigint" ||
      value.minorUnits < 0n
    )
      throw new TypeError("Invalid receivable amount");
  const outstanding =
    original.minorUnits - paid.minorUnits - returned.minorUnits;
  if (outstanding < 0n)
    throw new ReceivableConflictError("Receivable overpaid");
  return Object.freeze({
    outstandingAmount: money(outstanding),
    status:
      outstanding === 0n
        ? ("paid" as const)
        : outstanding === original.minorUnits
          ? ("open" as const)
          : ("partially_paid" as const),
  });
}
export function creditReturn(total: Money, outstanding: Money) {
  if (
    typeof total.minorUnits !== "bigint" ||
    typeof outstanding.minorUnits !== "bigint" ||
    total.minorUnits < 0n ||
    outstanding.minorUnits < 0n ||
    total.currency !== "MXN" ||
    outstanding.currency !== "MXN"
  )
    throw new TypeError("Invalid credit return");
  const reduction =
    total.minorUnits < outstanding.minorUnits
      ? total.minorUnits
      : outstanding.minorUnits;
  return Object.freeze({
    debtReduction: money(reduction),
    refundAmount: money(total.minorUnits - reduction),
  });
}

import { money, type Money } from "./money";
export class PayableConflictError extends Error {}
export function payableState(original: Money, paid: Money) {
  for (const v of [original, paid]) {
    if (
      v.currency !== "MXN" ||
      typeof v.minorUnits !== "bigint" ||
      v.minorUnits < 0n
    )
      throw new TypeError("Invalid payable money");
  }
  if (paid.minorUnits > original.minorUnits)
    throw new PayableConflictError("Payment exceeds debt");
  const outstanding = money(original.minorUnits - paid.minorUnits);
  return Object.freeze({
    original,
    paid,
    outstanding,
    status:
      outstanding.minorUnits === 0n
        ? ("paid" as const)
        : paid.minorUnits === 0n
          ? ("open" as const)
          : ("partially_paid" as const),
  });
}

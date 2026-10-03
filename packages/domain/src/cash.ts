import { money, type Money } from "./money";
export type CashMovementType = "cash_in" | "cash_out";
export function cashAmount(value: Money, positive = false): Money {
  if (
    !value ||
    value.currency !== "MXN" ||
    typeof value.minorUnits !== "bigint" ||
    value.minorUnits < 0n ||
    (positive && value.minorUnits === 0n)
  )
    throw new TypeError("Invalid cash amount");
  return money(value.minorUnits);
}
export function cashReason(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !value.length ||
    value.length > 200 ||
    !/[^\p{Cf}\p{M}\p{Z}]/u.test(value) ||
    /[\p{Cc}\p{Cs}\p{Cf}]/u.test(value)
  )
    throw new TypeError("Invalid cash reason");
  return value;
}
export function expectedCash(
  opening: Money,
  sales: Money,
  income: Money,
  withdrawals: Money,
): Money {
  const total =
    cashAmount(opening).minorUnits +
    cashAmount(sales).minorUnits +
    cashAmount(income).minorUnits -
    cashAmount(withdrawals).minorUnits;
  if (total < 0n) throw new RangeError("Insufficient cash");
  return money(total);
}
export function cashDifference(counted: Money, expected: Money): Money {
  return money(
    cashAmount(counted).minorUnits - cashAmount(expected).minorUnits,
  );
}

import { money, type Money } from "./money";
/** Rate in integer basis points; 10000 = 100%. No default fiscal rate.
 * 1000000 is a technical magnitude bound, not a legally valid rate list. */
export function taxRate(value: bigint): bigint {
  if (typeof value !== "bigint" || value < 0n || value > 1000000n)
    throw new TypeError("Invalid tax rate");
  return value;
}
export type TaxSnapshot = Readonly<{
  profileId: string;
  name: string;
  rate: bigint;
  base: Money;
  amount: Money;
}>;
export type TaxExpectation = Readonly<{
  productId: string;
  profileId: string;
  rate: bigint;
}>;
export type TaxRule = TaxExpectation & Readonly<{ name: string }>;
export class TaxProfileUnavailableError extends Error {}
export function taxAmount(base: Money, rate: bigint): Money {
  if (
    base.currency !== "MXN" ||
    typeof base.minorUnits !== "bigint" ||
    base.minorUnits < 0n
  )
    throw new TypeError("Invalid taxable base");
  return money((base.minorUnits * taxRate(rate) + 5000n) / 10000n);
}

import { minorUnitsToDecimal } from "./money-input";
/** Signed display only. Monetary inputs remain nonnegative and exact. */
export function formatCashMxn(minorUnits: string): string {
  if (minorUnits.startsWith("-")) {
    if (minorUnits === "-0") throw new Error("Invalid cash difference");
    return `-$${minorUnitsToDecimal(minorUnits.slice(1))} MXN`;
  }
  return `$${minorUnitsToDecimal(minorUnits)} MXN`;
}

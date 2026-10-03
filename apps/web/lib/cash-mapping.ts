import type { CashRegisterShift } from "@smartretail/application";
import type { CashShiftDto } from "@smartretail/contracts";
import type { Money } from "@smartretail/domain";
export const moneyDto = (m: Money) => ({
  currency: "MXN" as const,
  minorUnits: m.minorUnits.toString(),
});
export function cashShiftDto(s: CashRegisterShift): CashShiftDto {
  return {
    ...s,
    openingCash: moneyDto(s.openingCash),
    salesCash: moneyDto(s.salesCash),
    cashIn: moneyDto(s.cashIn),
    cashOut: moneyDto(s.cashOut),
    expectedCash: moneyDto(s.expectedCash),
    countedCash: s.countedCash ? moneyDto(s.countedCash) : null,
    difference: s.difference ? moneyDto(s.difference) : null,
  };
}

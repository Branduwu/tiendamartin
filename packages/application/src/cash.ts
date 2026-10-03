import {
  cashAmount,
  cashReason,
  inventoryLocationId,
  productId,
  type Money,
  type CashMovementType,
} from "@smartretail/domain";
export class CashStateConflictError extends Error {}
export type CashRegisterShift = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  openedBy: string;
  openedAt: string;
  openingCash: Money;
  status: "open" | "closed";
  salesCash: Money;
  cashIn: Money;
  cashOut: Money;
  expectedCash: Money;
  closedBy: string | null;
  closedAt: string | null;
  countedCash: Money | null;
  difference: Money | null;
}>;
export type CashMovement = Readonly<{
  id: string;
  shiftId: string;
  type: CashMovementType;
  amount: Money;
  reason: string;
  createdBy: string;
  createdAt: string;
}>;
export type OpenCashInput = Readonly<{
  id: string;
  locationId: string;
  openingCash: Money;
}>;
export type CashMoveInput = Readonly<{
  id: string;
  shiftId: string;
  type: CashMovementType;
  amount: Money;
  reason: string;
}>;
export interface CashRepository {
  currentShift(locationId: string): Promise<CashRegisterShift | null>;
  openShift(input: OpenCashInput): Promise<CashRegisterShift>;
  moveCash(input: CashMoveInput): Promise<CashMovement>;
  closeShift(id: string, counted: Money): Promise<CashRegisterShift>;
}
export function openCashRegisterShift(
  repo: CashRepository,
  input: OpenCashInput,
) {
  return repo.openShift({
    id: productId(input.id),
    locationId: inventoryLocationId(input.locationId),
    openingCash: cashAmount(input.openingCash),
  });
}
export function recordCashMovement(repo: CashRepository, input: CashMoveInput) {
  if (input.type !== "cash_in" && input.type !== "cash_out")
    throw new TypeError("Invalid movement");
  return repo.moveCash({
    ...input,
    id: productId(input.id),
    shiftId: productId(input.shiftId),
    amount: cashAmount(input.amount, true),
    reason: cashReason(input.reason),
  });
}
export function closeCashRegisterShift(
  repo: CashRepository,
  id: string,
  counted: Money,
) {
  return repo.closeShift(productId(id), cashAmount(counted));
}

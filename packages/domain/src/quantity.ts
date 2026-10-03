import { assertUnitCode, type UnitCode } from "./unit";

/** Fixed-three-decimal quantity: 1000n = one unit, 1n = one thousandth. */
export type Quantity = Readonly<{
  unit: UnitCode;
  milliUnits: bigint;
}>;

export class IncompatibleQuantityUnitError extends Error {
  constructor(a: UnitCode, b: UnitCode) {
    super(`Cannot operate on quantities with different units: ${a} and ${b}`);
    this.name = "IncompatibleQuantityUnitError";
  }
}

export function quantity(unit: UnitCode, milliUnits: bigint): Quantity {
  assertUnitCode(unit);
  if (typeof milliUnits !== "bigint") {
    throw new TypeError("Quantity requires bigint milliUnits");
  }
  return Object.freeze({ unit, milliUnits });
}

function assertQuantity(value: Quantity): void {
  if (!value || typeof value.milliUnits !== "bigint") {
    throw new TypeError("Expected Quantity with bigint milliUnits");
  }
  assertUnitCode(value.unit);
}

function assertCompatible(a: Quantity, b: Quantity): void {
  assertQuantity(a);
  assertQuantity(b);
  if (a.unit !== b.unit) {
    throw new IncompatibleQuantityUnitError(a.unit, b.unit);
  }
}

export function addQuantity(a: Quantity, b: Quantity): Quantity {
  assertCompatible(a, b);
  return quantity(a.unit, a.milliUnits + b.milliUnits);
}

export function subtractQuantity(a: Quantity, b: Quantity): Quantity {
  assertCompatible(a, b);
  return quantity(a.unit, a.milliUnits - b.milliUnits);
}

/** Returns -1 when a < b, 0 when equal, and 1 when a > b; units must match. */
export function compareQuantity(a: Quantity, b: Quantity): -1 | 0 | 1 {
  assertCompatible(a, b);
  return a.milliUnits < b.milliUnits ? -1 : a.milliUnits > b.milliUnits ? 1 : 0;
}

export function isZeroQuantity(value: Quantity): boolean {
  assertQuantity(value);
  return value.milliUnits === 0n;
}

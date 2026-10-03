/** Exact MXN minor units: 100n represents one peso. Not a JSON DTO. */
export type Money = Readonly<{
  currency: "MXN";
  minorUnits: bigint;
}>;

export function money(minorUnits: bigint): Money {
  if (typeof minorUnits !== "bigint") {
    throw new TypeError("Money requires bigint minorUnits");
  }
  return Object.freeze({ currency: "MXN", minorUnits });
}

function assertMoney(value: Money): void {
  if (
    !value ||
    value.currency !== "MXN" ||
    typeof value.minorUnits !== "bigint"
  ) {
    throw new TypeError("Expected MXN Money with bigint minorUnits");
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertMoney(a);
  assertMoney(b);
  return money(a.minorUnits + b.minorUnits);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertMoney(a);
  assertMoney(b);
  return money(a.minorUnits - b.minorUnits);
}

/** Returns -1 when a < b, 0 when equal, and 1 when a > b. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertMoney(a);
  assertMoney(b);
  return a.minorUnits < b.minorUnits ? -1 : a.minorUnits > b.minorUnits ? 1 : 0;
}

export function isZeroMoney(value: Money): boolean {
  assertMoney(value);
  return value.minorUnits === 0n;
}

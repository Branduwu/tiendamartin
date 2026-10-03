import { describe, expect, expectTypeOf, it } from "vitest";
import {
  quantity,
  addQuantity,
  subtractQuantity,
  compareQuantity,
  isZeroQuantity,
  IncompatibleQuantityUnitError,
  type UnitCode,
  type Quantity,
} from "../src/index";

const units = ["piece", "kg", "g", "l", "ml", "m", "cm"] as const;

describe("Quantity", () => {
  it.each(units)("represents one %s using 1000 milliUnits", (unit) => {
    expect(quantity(unit, 1000n)).toStrictEqual({ unit, milliUnits: 1000n });
  });

  it.each([0n, 1n, 1250n, -500n, 9007199254740993123456789n])(
    "preserves exact signed milliUnits %s",
    (milliUnits) => {
      expect(quantity("kg", milliUnits)).toStrictEqual({
        unit: "kg",
        milliUnits,
      });
    },
  );

  it("permits fractional pieces without imposing product rules", () => {
    expect(quantity("piece", 500n).milliUnits).toBe(500n);
    expect(quantity("piece", -1n).milliUnits).toBe(-1n);
  });

  it("exposes a closed unit type, bigint input and readonly values", () => {
    expectTypeOf<UnitCode>().toEqualTypeOf<
      "piece" | "kg" | "g" | "l" | "ml" | "m" | "cm"
    >();
    expectTypeOf(quantity).parameter(1).toEqualTypeOf<bigint>();
    expectTypeOf<Quantity>().toEqualTypeOf<
      Readonly<{ unit: UnitCode; milliUnits: bigint }>
    >();
  });

  it.each([1000, 1.25, "1000", null, undefined, NaN, Infinity])(
    "rejects non-bigint values without conversion: %s",
    (value) => {
      expect(() => Reflect.apply(quantity, undefined, ["kg", value])).toThrow(
        TypeError,
      );
    },
  );

  it.each(["KG", "Piece", "unit", "box", " kg", "", 1, null, undefined])(
    "rejects unsupported runtime units without parsing: %s",
    (unit) => {
      expect(() => Reflect.apply(quantity, undefined, [unit, 1000n])).toThrow(
        TypeError,
      );
    },
  );

  it("adds quantities of the same unit exactly", () => {
    expect(addQuantity(quantity("kg", 1000n), quantity("kg", 500n))).toEqual(
      quantity("kg", 1500n),
    );
    expect(addQuantity(quantity("kg", 1000n), quantity("kg", -500n))).toEqual(
      quantity("kg", 500n),
    );
  });

  it("preserves thousandth precision and integers beyond number's safe range", () => {
    expect(addQuantity(quantity("m", 100n), quantity("m", 200n))).toEqual(
      quantity("m", 300n),
    );
    expect(
      addQuantity(quantity("g", 9007199254740993n), quantity("g", 1n)),
    ).toEqual(quantity("g", 9007199254740994n));
  });

  it("subtracts into a negative quantity", () => {
    expect(
      subtractQuantity(quantity("kg", 1000n), quantity("kg", 1500n)),
    ).toEqual(quantity("kg", -500n));
  });

  it.each([
    [-500n, 0n, -1],
    [1000n, 1000n, 0],
    [9007199254740994n, 9007199254740993n, 1],
  ] as const)("compares %s and %s with identical units", (a, b, expected) => {
    expect(compareQuantity(quantity("ml", a), quantity("ml", b))).toBe(
      expected,
    );
  });

  it.each([
    [0n, true],
    [1n, false],
    [-1n, false],
  ] as const)("identifies zero for %s", (value, expected) => {
    expect(isZeroQuantity(quantity("cm", value))).toBe(expected);
  });

  it.each(
    units.flatMap((a) => units.filter((b) => a !== b).map((b) => ({ a, b }))),
  )(
    "rejects add/subtract/compare between $a and $b without converting",
    ({ a, b }) => {
      const left = quantity(a, 1000n);
      const right = quantity(b, 500000n);
      for (const operation of [
        addQuantity,
        subtractQuantity,
        compareQuantity,
      ]) {
        expect(() => operation(left, right)).toThrow(
          IncompatibleQuantityUnitError,
        );
      }
      expect(left).toEqual(quantity(a, 1000n));
      expect(right).toEqual(quantity(b, 500000n));
    },
  );

  it("also rejects comparisons between zeros with different units", () => {
    expect(() =>
      compareQuantity(quantity("kg", 0n), quantity("g", 0n)),
    ).toThrow(IncompatibleQuantityUnitError);
  });

  it("keeps operands unchanged and freezes all produced values", () => {
    const a = quantity("l", 1000n);
    const b = quantity("l", -500n);
    const sum = addQuantity(a, b);
    const difference = subtractQuantity(a, b);
    compareQuantity(a, b);
    isZeroQuantity(a);
    for (const value of [a, b, sum, difference]) {
      expect(Reflect.set(value, "milliUnits", 999n)).toBe(false);
      expect(Reflect.set(value, "unit", "ml")).toBe(false);
    }
    expect(a).toEqual(quantity("l", 1000n));
    expect(b).toEqual(quantity("l", -500n));
    expect(sum).toEqual(quantity("l", 500n));
    expect(difference).toEqual(quantity("l", 1500n));
  });

  it("guards operations against invalid JavaScript operands", () => {
    for (const invalid of [
      null,
      { unit: "kg", milliUnits: 1000 },
      { unit: "kg", milliUnits: "1000" },
      { unit: "box", milliUnits: 1000n },
    ]) {
      for (const operation of [
        addQuantity,
        subtractQuantity,
        compareQuantity,
      ]) {
        expect(() =>
          Reflect.apply(operation, undefined, [invalid, quantity("kg", 0n)]),
        ).toThrow(TypeError);
        expect(() =>
          Reflect.apply(operation, undefined, [quantity("kg", 0n), invalid]),
        ).toThrow(TypeError);
      }
      expect(() => Reflect.apply(isZeroQuantity, undefined, [invalid])).toThrow(
        TypeError,
      );
    }
  });
});

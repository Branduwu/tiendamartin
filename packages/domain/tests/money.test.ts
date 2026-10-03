import { describe, expect, expectTypeOf, it } from "vitest";
import {
  addMoney,
  compareMoney,
  isZeroMoney,
  money,
  subtractMoney,
  type Money,
} from "../src/index";

describe("Money", () => {
  it.each([0n, 1250n, -500n, 9007199254740993123456789n])(
    "creates exact MXN minor units %s",
    (minorUnits) => {
      expect(money(minorUnits)).toStrictEqual({ currency: "MXN", minorUnits });
    },
  );

  it("exposes bigint inputs and readonly values", () => {
    expectTypeOf(money).parameter(0).toEqualTypeOf<bigint>();
    expectTypeOf<Money>().toEqualTypeOf<
      Readonly<{ currency: "MXN"; minorUnits: bigint }>
    >();
  });

  it.each([100, 1.25, NaN, Infinity, "100", null, undefined])(
    "rejects non-bigint input without conversion: %s",
    (input) => {
      expect(() => Reflect.apply(money, undefined, [input])).toThrow(TypeError);
    },
  );

  it("adds exact positive and negative amounts", () => {
    expect(addMoney(money(100n), money(250n))).toEqual(money(350n));
    expect(addMoney(money(100n), money(-50n))).toEqual(money(50n));
    expect(addMoney(money(9007199254740993n), money(1n))).toEqual(
      money(9007199254740994n),
    );
  });

  it("subtracts across zero", () => {
    expect(subtractMoney(money(100n), money(250n))).toEqual(money(-150n));
  });

  it.each([
    [-1n, 0n, -1],
    [100n, 100n, 0],
    [9007199254740994n, 9007199254740993n, 1],
  ] as const)("compares %s and %s", (a, b, expected) => {
    expect(compareMoney(money(a), money(b))).toBe(expected);
  });

  it.each([
    [0n, true],
    [1n, false],
    [-1n, false],
  ] as const)("identifies zero for %s", (value, expected) => {
    expect(isZeroMoney(money(value))).toBe(expected);
  });

  it("preserves operands and returns immutable results", () => {
    const a = money(100n);
    const b = money(-50n);
    const sum = addMoney(a, b);
    const difference = subtractMoney(a, b);
    compareMoney(a, b);
    isZeroMoney(a);
    expect(a).toEqual(money(100n));
    expect(b).toEqual(money(-50n));
    for (const value of [a, b, sum, difference]) {
      expect(Reflect.set(value, "minorUnits", 999n)).toBe(false);
      expect(Reflect.set(value, "currency", "USD")).toBe(false);
    }
    expect(sum).toEqual(money(50n));
    expect(difference).toEqual(money(150n));
  });

  it("rejects invalid operands even for JavaScript callers", () => {
    for (const invalid of [
      { currency: "MXN", minorUnits: 100 },
      { currency: "MXN", minorUnits: "100" },
      { currency: "USD", minorUnits: 100n },
      null,
    ]) {
      for (const operation of [addMoney, subtractMoney, compareMoney]) {
        expect(() =>
          Reflect.apply(operation, undefined, [invalid, money(0n)]),
        ).toThrow(TypeError);
        expect(() =>
          Reflect.apply(operation, undefined, [money(0n), invalid]),
        ).toThrow(TypeError);
      }
      expect(() => Reflect.apply(isZeroMoney, undefined, [invalid])).toThrow(
        TypeError,
      );
    }
  });
});

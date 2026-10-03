import { expect, it } from "vitest";
import { money, salePayments } from "../src/index";
it.each(["cash", "card"] as const)("registers %s with exact MXN", (method) => {
  expect(
    salePayments([{ method, amount: money(1234n) }], money(1234n))[0]?.amount
      .minorUnits,
  ).toBe(1234n);
});
it("mixed payment sums exactly and is immutable", () => {
  const payments = salePayments(
    [
      { method: "cash", amount: money(100n) },
      { method: "card", amount: money(200n) },
    ],
    money(300n),
  );
  expect(Object.isFrozen(payments) && Object.isFrozen(payments[0])).toBe(true);
});
it("rejects missing, excess, zero and negative payments", () => {
  for (const amount of [0n, -1n, 99n, 101n])
    expect(() =>
      salePayments([{ method: "cash", amount: money(amount) }], money(100n)),
    ).toThrow();
});
it("rejects duplicate methods and forged number money", () => {
  expect(() =>
    salePayments(
      [
        { method: "cash", amount: money(50n) },
        { method: "cash", amount: money(50n) },
      ],
      money(100n),
    ),
  ).toThrow();
  expect(() =>
    salePayments(
      [
        {
          method: "card",
          amount: { currency: "MXN", minorUnits: 100 } as unknown as ReturnType<
            typeof money
          >,
        },
      ],
      money(100n),
    ),
  ).toThrow();
});
it("zero-price sale has no positive tender to record", () => {
  expect(salePayments([], money(0n))).toEqual([]);
  expect(() => salePayments([], money(1n))).toThrow();
});

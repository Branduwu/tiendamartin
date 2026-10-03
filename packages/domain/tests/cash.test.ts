import { expect, it } from "vitest";
import {
  money,
  cashAmount,
  cashReason,
  expectedCash,
  cashDifference,
} from "../src/index";
it.each([0n, 1n, 9007199254740993n])(
  "cash amount accepts exact nonnegative %s",
  (n) => expect(cashAmount(money(n)).minorUnits).toBe(n),
);
it("expected cash combines only the supplied cash ledger", () =>
  expect(
    expectedCash(money(100n), money(50n), money(10n), money(20n)).minorUnits,
  ).toBe(140n));
it.each([
  [-5n, 95n],
  [0n, 100n],
  [5n, 105n],
])("allows closing difference %s", (diff, counted) =>
  expect(cashDifference(money(counted), money(100n)).minorUnits).toBe(diff),
);
it("negative cash and zero movements fail", () => {
  expect(() => cashAmount(money(-1n))).toThrow();
  expect(() => cashAmount(money(0n), true)).toThrow();
  expect(() =>
    expectedCash(money(0n), money(0n), money(0n), money(1n)),
  ).toThrow();
});
it("reason is mandatory bounded visible text", () => {
  expect(cashReason("SMOKE ingreso")).toBe("SMOKE ingreso");
  for (const r of ["", " ", "x\n", "\u200b", "x".repeat(201)])
    expect(() => cashReason(r)).toThrow();
});

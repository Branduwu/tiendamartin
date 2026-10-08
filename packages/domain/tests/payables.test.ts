import { it, expect } from "vitest";
import { money, payableState } from "../src/index";
it("zero account is paid", () =>
  expect(payableState(money(0n), money(0n)).status).toBe("paid"));
it("open and partial debt exact", () => {
  expect(payableState(money(100n), money(0n)).status).toBe("open");
  expect(payableState(money(100n), money(33n)).outstanding.minorUnits).toBe(
    67n,
  );
});
it("full payment closes exact large bigint", () => {
  const v = money(999999999999999999999n);
  expect(payableState(v, v).status).toBe("paid");
});
it("overpayment and negative rejected", () => {
  expect(() => payableState(money(1n), money(2n))).toThrow();
  expect(() => payableState(money(-1n), money(0n))).toThrow();
});
it("immutable operands remain unchanged", () => {
  const a = money(100n),
    b = money(50n),
    state = payableState(a, b);
  expect(a.minorUnits).toBe(100n);
  expect(b.minorUnits).toBe(50n);
  expect(Object.isFrozen(state)).toBe(true);
});

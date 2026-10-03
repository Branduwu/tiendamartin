import { expect, it } from "vitest";
import { formatCashMxn } from "./cash-display";
it("shows exact zero and positive cash", () => {
  expect(formatCashMxn("0")).toBe("$0.00 MXN");
  expect(formatCashMxn("50")).toBe("$0.50 MXN");
});
it("shows a shortage without throwing during rendering", () =>
  expect(formatCashMxn("-50")).toBe("-$0.50 MXN"));
it("retains precision beyond safe JS integers", () =>
  expect(formatCashMxn("-9007199254740993")).toBe("-$90071992547409.93 MXN"));
it("rejects noncanonical display amounts", () => {
  for (const value of ["-0", "-01", "-1.5", "+1", "--1"])
    expect(() => formatCashMxn(value)).toThrow();
});

import { describe, it, expect } from "vitest";
import {
  money,
  receivableState,
  creditReturn,
  customerFields,
  salePayments,
} from "../src/index";
describe("exact customer credit", () => {
  it("derives open partial and paid without mutating original", () => {
    const original = money(9007199254740993n);
    expect(receivableState(original, money(0n), money(0n)).status).toBe("open");
    expect(
      receivableState(original, money(1n), money(2n)).outstandingAmount
        .minorUnits,
    ).toBe(9007199254740990n);
    expect(receivableState(money(10n), money(6n), money(4n)).status).toBe(
      "paid",
    );
    expect(original.minorUnits).toBe(9007199254740993n);
  });
  it("rejects negative ledgers and overpayment", () => {
    expect(() => receivableState(money(10n), money(11n), money(0n))).toThrow();
    expect(() => receivableState(money(10n), money(-1n), money(0n))).toThrow();
  });
  it("return cancels debt before any money refund", () => {
    expect(creditReturn(money(2000n), money(3000n))).toEqual({
      debtReduction: money(2000n),
      refundAmount: money(0n),
    });
    expect(creditReturn(money(2000n), money(750n))).toEqual({
      debtReduction: money(750n),
      refundAmount: money(1250n),
    });
    expect(creditReturn(money(1n), money(0n)).refundAmount.minorUnits).toBe(1n);
  });
  it("credit is an exact tender, never a float", () => {
    expect(
      salePayments(
        [
          { method: "cash", amount: money(500n) },
          { method: "card", amount: money(100n) },
          { method: "credit", amount: money(400n) },
        ],
        money(1000n),
      ),
    ).toHaveLength(3);
    expect(() =>
      salePayments([{ method: "credit", amount: money(999n) }], money(1000n)),
    ).toThrow();
  });
  it("customer credit is opt in and limit exact nonnegative", () => {
    expect(
      customerFields({ name: "Customer", status: "active" }).creditEnabled,
    ).toBeUndefined();
    expect(
      customerFields({
        name: "Customer",
        status: "active",
        creditEnabled: true,
        creditLimit: money(1n),
      }).creditLimit,
    ).toEqual(money(1n));
    expect(() =>
      customerFields({
        name: "Customer",
        status: "active",
        creditLimit: money(-1n),
      }),
    ).toThrow();
  });
});

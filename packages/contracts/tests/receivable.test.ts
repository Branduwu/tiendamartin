import { it, expect } from "vitest";
import {
  ReceivablePaymentInputSchema,
  SalePaymentSchema,
  CreateCustomerSchema,
  CreateSaleReturnSchema,
} from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440000",
  amount = { currency: "MXN", minorUnits: "1" };
it("collection accepts card and cash only with required shift", () => {
  expect(
    ReceivablePaymentInputSchema.safeParse({ id, method: "card", amount })
      .success,
  ).toBe(true);
  expect(
    ReceivablePaymentInputSchema.safeParse({
      id,
      method: "cash",
      amount,
      shiftId: id,
    }).success,
  ).toBe(true);
  for (const value of [
    { id, method: "cash", amount },
    { id, method: "card", amount, shiftId: id },
    { id, method: "credit", amount },
    { id, method: "card", amount, role: "owner" },
  ])
    expect(ReceivablePaymentInputSchema.safeParse(value).success).toBe(false);
});
it("collection does not coerce zero negative numeric decimal or oversized amount", () => {
  for (const minorUnits of ["0", "-1", 1, 1n, "1.0", "01", "1".repeat(129)])
    expect(
      ReceivablePaymentInputSchema.safeParse({
        id,
        method: "card",
        amount: { currency: "MXN", minorUnits },
      }).success,
    ).toBe(false);
});
it("sale permits credit but return contract never permits credit refund", () => {
  expect(
    SalePaymentSchema.safeParse({ method: "credit", amount }).success,
  ).toBe(true);
  expect(
    CreateSaleReturnSchema.safeParse({
      id,
      lines: [],
      refunds: [{ method: "credit", amount }],
    }).success,
  ).toBe(false);
});
it("customer credit limit remains explicit optional canonical money", () => {
  expect(
    CreateCustomerSchema.safeParse({
      id,
      name: "Customer",
      status: "active",
      creditEnabled: true,
      creditLimit: amount,
    }).success,
  ).toBe(true);
  for (const creditLimit of [-1, "100", { currency: "MXN", minorUnits: "-1" }])
    expect(
      CreateCustomerSchema.safeParse({
        id,
        name: "Customer",
        status: "active",
        creditLimit,
      }).success,
    ).toBe(false);
});

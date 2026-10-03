import { expect, it } from "vitest";
import { SalePaymentSchema, CheckoutSchema } from "../src/index";
const payment = {
  method: "cash",
  amount: { currency: "MXN", minorUnits: "100" },
};
it("strict payment accepts serialized cash and card", () => {
  expect(SalePaymentSchema.safeParse(payment).success).toBe(true);
  expect(
    SalePaymentSchema.safeParse({ ...payment, method: "card" }).success,
  ).toBe(true);
});
it("rejects forged payment types, currency, zero, negative and extra fields", () => {
  for (const amount of [0, 100n, "0", "-1", "1.1", "01"])
    expect(
      SalePaymentSchema.safeParse({
        ...payment,
        amount: { currency: "MXN", minorUnits: amount },
      }).success,
    ).toBe(false);
  expect(
    SalePaymentSchema.safeParse({ ...payment, reference: "not-implemented" })
      .success,
  ).toBe(false);
  expect(
    SalePaymentSchema.safeParse({
      ...payment,
      amount: { currency: "USD", minorUnits: "1" },
    }).success,
  ).toBe(false);
});
it("checkout rejects client identity, role and completed draft", () => {
  const input = {
    draft: {
      id: "550e8400-e29b-41d4-a716-446655440010",
      status: "draft",
      lines: [],
      total: { currency: "MXN", minorUnits: "0" },
    },
    locationId: "550e8400-e29b-41d4-a716-446655440011",
    payments: [],
    movements: [
      {
        productId: "550e8400-e29b-41d4-a716-446655440012",
        movementId: "550e8400-e29b-41d4-a716-446655440013",
      },
    ],
  };
  expect(
    CheckoutSchema.safeParse({ ...input, userId: "forged", role: "owner" })
      .success,
  ).toBe(false);
  expect(
    CheckoutSchema.safeParse({
      ...input,
      draft: { ...input.draft, status: "completed" },
    }).success,
  ).toBe(false);
});

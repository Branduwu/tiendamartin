import { it, expect } from "vitest";
import { ExpenseSchema, SupplierPaymentSchema } from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440001",
  payment = {
    id,
    method: "card",
    amount: { currency: "MXN", minorUnits: "100" },
  };
it("cash requires shift and noncash forbids shift", () => {
  expect(
    SupplierPaymentSchema.safeParse({ ...payment, method: "cash" }).success,
  ).toBe(false);
  expect(
    SupplierPaymentSchema.safeParse({ ...payment, method: "cash", shiftId: id })
      .success,
  ).toBe(true);
  expect(
    SupplierPaymentSchema.safeParse({ ...payment, shiftId: id }).success,
  ).toBe(false);
});
it("strict positive canonical amounts no coercion", () => {
  for (const minorUnits of ["0", "-1", "01", "1.2", 100, 100n])
    expect(
      SupplierPaymentSchema.safeParse({
        ...payment,
        amount: { currency: "MXN", minorUnits },
      }).success,
    ).toBe(false);
  expect(
    SupplierPaymentSchema.safeParse({ ...payment, role: "owner" }).success,
  ).toBe(false);
});
it("expense bank general allowed but cash needs location", () => {
  expect(
    ExpenseSchema.safeParse({
      ...payment,
      method: "bank",
      category: "renta",
      description: "Test",
    }).success,
  ).toBe(true);
  expect(
    ExpenseSchema.safeParse({
      ...payment,
      method: "cash",
      shiftId: id,
      category: "renta",
      description: "Test",
    }).success,
  ).toBe(false);
});
it("expense rejects control chars giant text unexpected category and extra keys", () => {
  const e = { ...payment, category: "otros", description: "Test" };
  for (const description of ["", " test", "a".repeat(501), "a\n"])
    expect(ExpenseSchema.safeParse({ ...e, description }).success).toBe(false);
  expect(ExpenseSchema.safeParse({ ...e, category: "invalid" }).success).toBe(
    false,
  );
  expect(ExpenseSchema.safeParse({ ...e, createdBy: id }).success).toBe(false);
});

import { expect, it } from "vitest";
import {
  NewPasswordSchema,
  ResetPasswordSchema,
  ChangePasswordSchema,
  CustomerFieldsSchema,
  SupplierFieldsSchema,
  ExpenseSchema,
} from "../src";
it.each([
  "José Muñoz Café Niño",
  'O\'Connor "El Centro"',
  "Espacios $€ 😊 válidos",
])("keeps legitimate password characters: %s", (value) => {
  expect(NewPasswordSchema.parse(value)).toBe(value);
});
it.each(["short", "x".repeat(129), "Password\u0000", "Password\ud800"])(
  "rejects technical/length-invalid password %#",
  (value) => {
    expect(NewPasswordSchema.safeParse(value).success).toBe(false);
  },
);
it("accepts exact policy boundary without trimming password", () => {
  expect(NewPasswordSchema.parse("  a12345")).toBe("  a12345");
  expect(NewPasswordSchema.parse("x".repeat(128))).toHaveLength(128);
});
it("requires matching credentials and rejects coercion/extra identity", () => {
  const value = {
    code: "test",
    password: "Password9!",
    confirmation: "Password9!",
  };
  expect(ResetPasswordSchema.safeParse(value).success).toBe(true);
  expect(
    ResetPasswordSchema.safeParse({ ...value, confirmation: "Other123!" })
      .success,
  ).toBe(false);
  expect(ResetPasswordSchema.safeParse({ ...value, code: 100 }).success).toBe(
    false,
  );
  expect(
    ChangePasswordSchema.safeParse({
      password: value.password,
      confirmation: value.password,
      currentPassword: "old",
      userId: "forged",
    }).success,
  ).toBe(false);
});
it("commercial names preserve Unicode, quotes and harmless hostile text", () => {
  for (const name of [
    "José Muñoz Café Niño",
    "O'Connor",
    'Tienda "El Centro"',
    "<script>alert(1)</script>",
  ]) {
    expect(
      CustomerFieldsSchema.safeParse({
        name,
        status: "active",
        notes: "Entrega 😊\nSiguiente día",
      }).success,
    ).toBe(true);
    expect(
      SupplierFieldsSchema.safeParse({ name, status: "active" }).success,
    ).toBe(true);
  }
});
it.each(["bad\ud800", "bad\u0000"])(
  "rejects database-incompatible text without banning symbols %#",
  (name) => {
    expect(
      CustomerFieldsSchema.safeParse({ name, status: "active" }).success,
    ).toBe(false);
    expect(
      SupplierFieldsSchema.safeParse({ name, status: "active" }).success,
    ).toBe(false);
    expect(
      ExpenseSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440020",
        category: "otros",
        description: name,
        amount: { currency: "MXN", minorUnits: "100" },
        method: "bank",
      }).success,
    ).toBe(false);
  },
);

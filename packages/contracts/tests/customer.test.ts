import { describe, it, expect } from "vitest";
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  CustomerSearchSchema,
  SaleDraftSchema,
} from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440031",
  customer = { id, name: "Ada", status: "active" };
describe("customer contracts", () => {
  it("accepts minimal/customer contact fields and explicit clearing in patches", () => {
    expect(CreateCustomerSchema.safeParse(customer).success).toBe(true);
    expect(
      CreateCustomerSchema.safeParse({
        ...customer,
        phone: "123",
        email: "ada@example.invalid",
        notes: "hello",
      }).success,
    ).toBe(true);
    expect(
      UpdateCustomerSchema.safeParse({ phone: null, email: null, notes: null })
        .success,
    ).toBe(true);
  });
  it("strict objects reject unnecessary personal data, coercion and invalid email", () => {
    for (const extra of [
      { role: "owner" },
      { tenantId: id },
      { rfc: "X" },
      { phone: 123 },
      { email: "invalid" },
      { notes: "a".repeat(2001) },
    ])
      expect(
        CreateCustomerSchema.safeParse({ ...customer, ...extra }).success,
      ).toBe(false);
    expect(UpdateCustomerSchema.safeParse({}).success).toBe(false);
    expect(UpdateCustomerSchema.safeParse({ name: undefined }).success).toBe(
      false,
    );
  });
  it("bounded search has no implicit string coercion", () => {
    expect(CustomerSearchSchema.parse(" Ada ")).toBe("Ada");
    expect(CustomerSearchSchema.safeParse("a".repeat(201)).success).toBe(false);
    expect(CustomerSearchSchema.safeParse(1).success).toBe(false);
  });
  it("sales accept only an optional customer UUID rather than browser customer records", () => {
    const draft = {
      id,
      status: "draft",
      total: { currency: "MXN", minorUnits: "0" },
      lines: [],
    };
    expect(SaleDraftSchema.safeParse(draft).success).toBe(true);
    expect(
      SaleDraftSchema.safeParse({ ...draft, customerId: id }).success,
    ).toBe(true);
    for (const value of [null, 123, "bad"])
      expect(
        SaleDraftSchema.safeParse({ ...draft, customerId: value }).success,
      ).toBe(false);
    expect(SaleDraftSchema.safeParse({ ...draft, customer }).success).toBe(
      false,
    );
  });
});

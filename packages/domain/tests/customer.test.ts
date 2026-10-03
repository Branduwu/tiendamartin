import { describe, it, expect } from "vitest";
import {
  customerFields,
  customerId,
  createSaleDraft,
  assignSaleCustomer,
  addSaleProduct,
  completeSale,
  createProduct,
  productId,
  productName,
  sku,
  money,
  quantity,
} from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440031";
describe("customers domain", () => {
  it("canonical customer fields retain only necessary optional information", () => {
    expect(customerId(id.toUpperCase())).toBe(id);
    expect(
      customerFields({
        name: "  Ada  ",
        status: "active",
        phone: " 123 ",
        notes: "Hello",
      }),
    ).toEqual({ name: "Ada", status: "active", phone: "123", notes: "Hello" });
  });
  it("bounds text and rejects empty/control/status input", () => {
    for (const name of [" ", "x".repeat(201), "x\u0000"])
      expect(() => customerFields({ name, status: "active" })).toThrow();
    expect(() =>
      customerFields({ name: "Ada", status: "wrong" as "active" }),
    ).toThrow();
  });
  it("customer survives line editing/completion without altering totals or operands", () => {
    const original = createSaleDraft(id),
      picked = assignSaleCustomer(original, id);
    const p = createProduct({
      id: productId(id),
      name: productName("A"),
      sku: sku("A"),
      unit: "piece",
      purchaseCost: money(0n),
      salePrice: money(1250n),
      status: "active",
    });
    const sale = completeSale(
      addSaleProduct(picked, p, quantity("piece", 1000n)),
    );
    expect(sale.customerId).toBe(id);
    expect(sale.total.minorUnits).toBe(1250n);
    expect(original.customerId).toBeUndefined();
    expect(() => assignSaleCustomer(sale)).toThrow();
  });
  it("customer remains optional and can be removed while draft", () => {
    expect(
      assignSaleCustomer(createSaleDraft(id, id)).customerId,
    ).toBeUndefined();
    expect(() => assignSaleCustomer(createSaleDraft(id), "bad")).toThrow();
  });
});

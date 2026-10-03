import { describe, it, expect } from "vitest";
import {
  CreateSupplierSchema,
  UpdateSupplierSchema,
  CreatePurchaseOrderSchema,
  ReceivePurchaseOrderSchema,
} from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440001";
const line = {
  productId: id,
  quantityOrdered: { unit: "piece", milliUnits: "1000" },
  unitCost: { currency: "MXN", minorUnits: "0" },
};
describe("purchasing contracts", () => {
  it("validates supplier optional fields and updates without client authority", () => {
    expect(
      CreateSupplierSchema.safeParse({
        id,
        name: "Supplier",
        email: "s@example.invalid",
        status: "active",
      }).success,
    ).toBe(true);
    expect(UpdateSupplierSchema.safeParse({ status: "inactive" }).success).toBe(
      true,
    );
    expect(UpdateSupplierSchema.safeParse({}).success).toBe(false);
    expect(
      CreateSupplierSchema.safeParse({
        id,
        name: "Supplier",
        status: "active",
        role: "owner",
      }).success,
    ).toBe(false);
  });
  it("rejects malformed supplier email and oversized notes", () => {
    expect(
      CreateSupplierSchema.safeParse({
        id,
        name: "Supplier",
        email: "broken",
        status: "active",
      }).success,
    ).toBe(false);
    expect(
      CreateSupplierSchema.safeParse({
        id,
        name: "Supplier",
        notes: "x".repeat(2001),
        status: "active",
      }).success,
    ).toBe(false);
  });
  it("accepts canonical serializable cost and quantity", () => {
    expect(
      CreatePurchaseOrderSchema.safeParse({
        id,
        supplierId: id,
        locationId: id,
        lines: [line],
      }).success,
    ).toBe(true);
  });
  it("rejects number/bigint/noncanonical quantity and negative costs", () => {
    for (const value of [
      1000,
      1000n,
      "01",
      "1e3",
      " 1000",
      "-1",
      "0",
      "1500",
    ]) {
      expect(
        CreatePurchaseOrderSchema.safeParse({
          id,
          supplierId: id,
          locationId: id,
          lines: [
            { ...line, quantityOrdered: { unit: "piece", milliUnits: value } },
          ],
        }).success,
      ).toBe(false);
    }
    expect(
      CreatePurchaseOrderSchema.safeParse({
        id,
        supplierId: id,
        locationId: id,
        lines: [{ ...line, unitCost: { currency: "MXN", minorUnits: "-1" } }],
      }).success,
    ).toBe(false);
  });
  it("bounds transport and rejects server-owned fields", () => {
    expect(
      CreatePurchaseOrderSchema.safeParse({
        id,
        supplierId: id,
        locationId: id,
        createdBy: id,
        lines: [line],
      }).success,
    ).toBe(false);
    expect(
      CreatePurchaseOrderSchema.safeParse({
        id,
        supplierId: id,
        locationId: id,
        lines: Array.from({ length: 51 }, () => line),
      }).success,
    ).toBe(false);
    expect(
      ReceivePurchaseOrderSchema.safeParse({
        id,
        lines: [
          {
            productId: id,
            quantity: { unit: "kg", milliUnits: "1".repeat(129) },
          },
        ],
      }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { startSale, executeSaleCommand, type SaleCommand } from "../src/index";
import {
  createProduct,
  productId,
  productName,
  sku,
  money,
  quantity,
  deactivateProduct,
} from "@smartretail/domain";

const product = createProduct({
  id: productId("550e8400-e29b-41d4-a716-446655440002"),
  name: productName("Product"),
  sku: sku("TEST"),
  unit: "piece",
  purchaseCost: money(0n),
  salePrice: money(100n),
  status: "active",
});
const start = () => startSale("550e8400-e29b-41d4-a716-446655440001");
describe("local sale application service", () => {
  it("orchestrates add/change/complete without persistence or stock", () => {
    const original = start();
    const added = executeSaleCommand(original, {
      type: "add-product",
      product,
      quantity: quantity("piece", 1000n),
    });
    const changed = executeSaleCommand(added, {
      type: "change-quantity",
      productId: product.id,
      quantity: quantity("piece", 2000n),
    });
    expect(executeSaleCommand(changed, { type: "complete" })).toMatchObject({
      status: "completed",
      total: money(200n),
    });
    expect(original.lines).toHaveLength(0);
  });
  it("delegates explicit removal", () => {
    const added = executeSaleCommand(start(), {
      type: "add-product",
      product,
      quantity: quantity("piece", 1000n),
    });
    expect(
      executeSaleCommand(added, { type: "remove-line", productId: product.id }),
    ).toEqual(start());
  });
  it("preserves domain rejection of inactive products and completed changes", () => {
    expect(() =>
      executeSaleCommand(start(), {
        type: "add-product",
        product: deactivateProduct(product),
        quantity: quantity("piece", 1000n),
      }),
    ).toThrow();
    const done = executeSaleCommand(
      executeSaleCommand(start(), {
        type: "add-product",
        product,
        quantity: quantity("piece", 1000n),
      }),
      { type: "complete" },
    );
    expect(() =>
      executeSaleCommand(done, { type: "remove-line", productId: product.id }),
    ).toThrow();
  });
  it("rejects unknown commands supplied through casts", () => {
    expect(() =>
      executeSaleCommand(start(), { type: "pay" } as unknown as SaleCommand),
    ).toThrow();
  });
});

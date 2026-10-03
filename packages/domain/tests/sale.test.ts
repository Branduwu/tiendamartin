import { describe, expect, it } from "vitest";
import {
  createSaleDraft,
  addSaleProduct,
  changeSaleQuantity,
  removeSaleLine,
  completeSale,
  calculateSaleLineTotal,
  saleId,
  createProduct,
  productId,
  productName,
  sku,
  money,
  quantity,
  changeSalePrice,
  renameProduct,
  changeProductSku,
  changeProductUnit,
  deactivateProduct,
  type Money,
  type Quantity,
  type Sale,
} from "../src/index";

const id = "550e8400-e29b-41d4-a716-446655440001";
const item = (
  minorUnits = 1000n,
  productUuid = "550e8400-e29b-41d4-a716-446655440002",
) =>
  createProduct({
    id: productId(productUuid),
    name: productName("Test product"),
    sku: sku("TEST-1"),
    unit: "kg",
    purchaseCost: money(0n),
    salePrice: money(minorUnits),
    status: "active",
  });
const empty = () => createSaleDraft(id);
const draft = () => addSaleProduct(empty(), item(), quantity("kg", 1000n));

describe("sales", () => {
  it("starts empty with an exact zero MXN total", () => {
    expect(empty()).toEqual({
      id,
      status: "draft",
      lines: [],
      total: money(0n),
    });
  });
  it("validates and canonicalizes SaleId", () => {
    expect(saleId(id.toUpperCase())).toBe(id);
    expect(() => saleId("invalid")).toThrow();
  });
  it("adds a product snapshot without storing the full Product", () => {
    expect(draft().lines[0]).toEqual({
      productId: item().id,
      name: item().name,
      sku: item().sku,
      unit: "kg",
      quantity: quantity("kg", 1000n),
      unitPrice: money(1000n),
      lineTotal: money(1000n),
    });
  });
  it("rejects an inactive product even when its line already exists", () => {
    expect(() =>
      addSaleProduct(draft(), deactivateProduct(item()), quantity("kg", 1000n)),
    ).toThrow();
  });
  it("merges the same UUID case-insensitively", () => {
    const combined = addSaleProduct(
      draft(),
      item(1000n, item().id.toUpperCase()),
      quantity("kg", 500n),
    );
    expect(combined.lines).toHaveLength(1);
    expect(combined.lines[0]?.quantity.milliUnits).toBe(1500n);
    expect(combined.total.minorUnits).toBe(1500n);
  });
  it("rejects incompatible product and quantity units", () => {
    expect(() =>
      addSaleProduct(empty(), item(), quantity("piece", 1000n)),
    ).toThrow();
  });
  it("rejects merging a product whose configured unit changed", () => {
    expect(() =>
      addSaleProduct(
        draft(),
        changeProductUnit(item(), "g"),
        quantity("g", 1000n),
      ),
    ).toThrow();
  });
  it.each([0n, -1n])("rejects adding nonpositive quantity %s", (amount) => {
    expect(() =>
      addSaleProduct(empty(), item(), quantity("kg", amount)),
    ).toThrow();
  });
  it("updates quantity and recalculates total from the captured price", () => {
    const updated = changeSaleQuantity(
      draft(),
      item().id,
      quantity("kg", 333n),
    );
    expect(updated.lines[0]?.lineTotal.minorUnits).toBe(333n);
    expect(updated.total.minorUnits).toBe(333n);
  });
  it.each([0n, -1000n])(
    "rejects changing quantity to %s without removing",
    (amount) => {
      const current = draft();
      expect(() =>
        changeSaleQuantity(current, item().id, quantity("kg", amount)),
      ).toThrow();
      expect(current.lines).toHaveLength(1);
    },
  );
  it("rejects changed quantity with the wrong unit", () => {
    expect(() =>
      changeSaleQuantity(draft(), item().id, quantity("g", 1000n)),
    ).toThrow();
  });
  it("removes a line explicitly and restores zero", () => {
    expect(removeSaleLine(draft(), item().id)).toEqual(empty());
  });
  it("rejects updates/removals of nonexistent lines", () => {
    expect(() =>
      changeSaleQuantity(empty(), item().id, quantity("kg", 1000n)),
    ).toThrow();
    expect(() => removeSaleLine(empty(), item().id)).toThrow();
  });
  it("preserves price/name/SKU when adding the edited Product again", () => {
    const edited = changeProductSku(
      renameProduct(changeSalePrice(item(), money(9000n)), "Changed"),
      "CHANGED",
    );
    const result = addSaleProduct(draft(), edited, quantity("kg", 1000n));
    expect(result.lines[0]).toMatchObject({
      name: "Test product",
      sku: "TEST-1",
      unitPrice: money(1000n),
    });
    expect(result.total.minorUnits).toBe(2000n);
  });
  it("copies mutable caller inputs and deeply freezes the resulting snapshots", () => {
    const source = { ...item(), salePrice: { ...item().salePrice } };
    const amount = { ...quantity("kg", 1000n) };
    const result = addSaleProduct(empty(), source, amount);
    source.name = productName("Changed");
    source.salePrice.minorUnits = 999n;
    amount.milliUnits = 42n;
    expect(result.lines[0]).toMatchObject({
      name: "Test product",
      unitPrice: money(1000n),
      quantity: quantity("kg", 1000n),
    });
    const line = result.lines[0];
    for (const value of [
      result,
      result.lines,
      result.total,
      line,
      line?.quantity,
      line?.unitPrice,
      line?.lineTotal,
    ])
      expect(Object.isFrozen(value)).toBe(true);
  });
  it.each([
    [1000n, 1000n, 1000n],
    [1000n, 500n, 500n],
    [1000n, 333n, 333n],
    [1n, 499n, 0n],
    [1n, 500n, 1n],
    [1n, 501n, 1n],
  ])(
    "computes %s cents times %s milliUnits as %s cents",
    (price, amount, expected) => {
      expect(
        calculateSaleLineTotal(money(price), quantity("kg", amount)).minorUnits,
      ).toBe(expected);
    },
  );
  it("sums individually rounded lines, rather than rounding the grand numerator", () => {
    const a = addSaleProduct(empty(), item(1n), quantity("kg", 500n));
    const b = addSaleProduct(
      a,
      item(1n, "550e8400-e29b-41d4-a716-446655440003"),
      quantity("kg", 500n),
    );
    expect(b.total.minorUnits).toBe(2n);
    expect(a.total.minorUnits).toBe(1n);
  });
  it("retains exact values beyond JS safe integer range", () => {
    const huge = 900719925474099312345n;
    expect(
      calculateSaleLineTotal(money(huge), quantity("kg", 3000n)).minorUnits,
    ).toBe(huge * 3n);
  });
  it("allows a zero-priced nonempty sale to complete", () => {
    expect(
      completeSale(addSaleProduct(empty(), item(0n), quantity("kg", 1000n)))
        .total,
    ).toEqual(money(0n));
  });
  it("rejects negative prices and JS numbers supplied through casts", () => {
    expect(() =>
      calculateSaleLineTotal(money(-1n), quantity("kg", 1n)),
    ).toThrow();
    expect(() =>
      calculateSaleLineTotal(
        { currency: "MXN", minorUnits: 1 } as unknown as Money,
        quantity("kg", 1n),
      ),
    ).toThrow();
    expect(() =>
      addSaleProduct(empty(), item(), {
        unit: "kg",
        milliUnits: "1000",
      } as unknown as Quantity),
    ).toThrow();
  });
  it("rejects completion of an empty draft", () => {
    expect(() => completeSale(empty())).toThrow();
  });
  it("completes immutably without changing the draft or adding payment/time data", () => {
    const current = draft(),
      completed = completeSale(current);
    expect(completed).toEqual({ ...current, status: "completed" });
    expect(current.status).toBe("draft");
    expect(Object.isFrozen(completed.lines[0]?.unitPrice)).toBe(true);
    expect(completed).not.toBe(current);
  });
  it("rejects every modification and repeat completion of a completed sale", () => {
    const completed = completeSale(draft());
    expect(() =>
      addSaleProduct(completed, item(), quantity("kg", 1n)),
    ).toThrow();
    expect(() =>
      changeSaleQuantity(completed, item().id, quantity("kg", 1n)),
    ).toThrow();
    expect(() => removeSaleLine(completed, item().id)).toThrow();
    expect(() => completeSale(completed)).toThrow();
  });
  it("rejects forged totals, duplicate lines and invalid states before operating", () => {
    const current = draft();
    for (const forged of [
      { ...current, total: money(9n) },
      { ...current, lines: [...current.lines, ...current.lines] },
      { ...current, status: "paid" },
    ])
      expect(() => removeSaleLine(forged as Sale, item().id)).toThrow();
    expect(() =>
      completeSale({
        ...current,
        lines: [{ ...current.lines[0]!, lineTotal: money(1n) }],
      }),
    ).toThrow();
  });
});

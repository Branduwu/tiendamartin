import { describe, it, expect } from "vitest";
import {
  createProduct,
  productId,
  productName,
  sku,
  money,
  quantity,
  createSaleDraft,
  addSaleProduct,
  priceDiscountedSale,
  applySaleTaxes,
  taxAmount,
  taxRate,
  discount,
  quoteSaleReturn,
  createSaleReturn,
} from "../src/index";
const pid = "550e8400-e29b-41d4-a716-446655440101",
  profileId = "550e8400-e29b-41d4-a716-446655440102",
  sid = "550e8400-e29b-41d4-a716-446655440103";
const rule = (rate = 775n) => ({
  productId: pid,
  profileId,
  name: "Configured tax",
  rate,
});
const draft = (price = 2000n, count = 1000n) =>
  addSaleProduct(
    createSaleDraft(sid),
    createProduct({
      id: productId(pid),
      name: productName("Product"),
      sku: sku("A"),
      unit: "piece",
      purchaseCost: money(0n),
      salePrice: money(price),
      status: "active",
    }),
    quantity("piece", count),
  );
const selection = [
  { saleLineId: pid, productId: pid, quantity: quantity("piece", 1000n) },
];
describe("exact exclusive taxes", () => {
  it("keeps unassigned sales untaxed", () => {
    const sale = priceDiscountedSale(draft()).sale;
    expect(applySaleTaxes(sale, [])).toEqual(sale);
  });
  it("applies configured rate and preserves exact immutable snapshots", () => {
    const source = priceDiscountedSale(draft()).sale;
    const sale = applySaleTaxes(source, [rule()]);
    expect(sale.total.minorUnits).toBe(2155n);
    expect(source.total.minorUnits).toBe(2000n);
    expect(Object.isFrozen(sale.lines[0]?.tax)).toBe(true);
  });
  it("uses HALF-UP and bigint beyond JS safe integer", () => {
    expect(taxAmount(money(1n), 5000n).minorUnits).toBe(1n);
    expect(taxAmount(money(9007199254740993n), 10000n).minorUnits).toBe(
      9007199254740993n,
    );
    expect(() => taxRate(-1n)).toThrow();
    expect(() => taxRate(1000001n)).toThrow();
  });
  it("taxes the base after line promotion sale discount and coupon", () => {
    const priced = priceDiscountedSale(
      draft(2000n, 3000n),
      { sale: discount("percentage", 1000n) },
      [
        {
          id: profileId,
          productId: pid,
          discount: discount("percentage", 1000n),
        },
      ],
      { id: sid, code: "SMOKE-TAX", discount: discount("percentage", 1000n) },
    );
    const sale = applySaleTaxes(priced.sale, [rule()]);
    expect(sale.lines[0]?.tax?.base.minorUnits).toBe(4374n);
    expect(sale.lines[0]?.tax?.amount.minorUnits).toBe(339n);
    expect(sale.total.minorUnits).toBe(4713n);
  });
  it("keeps zero-rate assignment explicit and rejects duplicate mappings", () => {
    const sale = priceDiscountedSale(draft()).sale;
    expect(applySaleTaxes(sale, [rule(0n)]).lines[0]?.tax?.rate).toBe(0n);
    expect(() => applySaleTaxes(sale, [rule(), rule()])).toThrow();
    expect(() =>
      applySaleTaxes(applySaleTaxes(sale, [rule()]), [rule()]),
    ).toThrow();
  });
  it("returns historical net and tax cumulatively and closes the original total", () => {
    const sale = applySaleTaxes(
      priceDiscountedSale(draft(2000n, 3000n), {
        sale: discount("amount", 1626n),
      }).sale,
      [rule()],
    );
    const first = createSaleReturn(
      profileId,
      sale,
      selection,
      [],
      [{ method: "card", amount: money(1571n) }],
    );
    expect(first.lines[0]?.refundedTax?.minorUnits).toBe(113n);
    const remaining = quoteSaleReturn(
      sale,
      [{ ...selection[0]!, quantity: quantity("piece", 2000n) }],
      [first],
    );
    expect(first.total.minorUnits + remaining.total.minorUnits).toBe(4713n);
    expect(remaining.lines[0]?.refundedTax?.minorUnits).toBe(226n);
  });
  it("rounds commercial and tax portions separately including a zero final refund", () => {
    const sale = applySaleTaxes(
      priceDiscountedSale(draft(1n, 2000n), { sale: discount("amount", 1n) })
        .sale,
      [rule(10000n)],
    );
    const first = createSaleReturn(
      profileId,
      sale,
      selection,
      [],
      [{ method: "card", amount: money(2n) }],
    );
    expect(first.total.minorUnits).toBe(2n);
    expect(quoteSaleReturn(sale, selection, [first]).total.minorUnits).toBe(0n);
  });
});

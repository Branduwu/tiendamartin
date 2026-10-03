import { expect, it } from "vitest";
import {
  createSaleDraft,
  addSaleProduct,
  completeSale,
  createProduct,
  productId,
  productName,
  sku,
  money,
  quantity,
  createSaleReturn,
  quoteSaleReturn,
  assertRefundLimits,
  SaleReturnConflictError,
} from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440001",
  pid = "550e8400-e29b-41d4-a716-446655440002";
const product = createProduct({
  id: productId(pid),
  name: productName("Original"),
  sku: sku("ORIGINAL"),
  unit: "piece",
  status: "active",
  purchaseCost: money(0n),
  salePrice: money(125n),
});
const sale = completeSale(
  addSaleProduct(createSaleDraft(id), product, quantity("piece", 5000n)),
);
const lines = (milli = 1000n) => [
  { saleLineId: pid, productId: pid, quantity: quantity("piece", milli) },
];
const refund = (amount: bigint, method: "cash" | "card" = "cash") => [
  { method, amount: money(amount) },
];
it("returns the entire immutable original quote", () => {
  const result = createSaleReturn(id, sale, lines(5000n), [], refund(625n));
  expect(result.total).toEqual(money(625n));
  expect(sale.lines[0]?.quantity.milliUnits).toBe(5000n);
  expect(Object.isFrozen(result.lines[0])).toBe(true);
});
it("partial and second return respect remaining historical quantity", () => {
  const first = createSaleReturn(id, sale, lines(2000n), [], refund(250n));
  expect(
    createSaleReturn(id, sale, lines(3000n), [first], refund(375n)).total
      .minorUnits,
  ).toBe(375n);
  expect(() =>
    createSaleReturn(id, sale, lines(4000n), [first], refund(500n)),
  ).toThrow(SaleReturnConflictError);
});
it("rejects zero, negative, mismatched unit and fractional pieces", () => {
  for (const q of [
    quantity("piece", 0n),
    quantity("piece", -1000n),
    quantity("piece", 1n),
    quantity("kg", 1000n),
  ])
    expect(() =>
      quoteSaleReturn(
        sale,
        [{ saleLineId: pid, productId: pid, quantity: q }],
        [],
      ),
    ).toThrow();
});
it("rejects unrelated sale line identity and duplicate selections", () => {
  expect(() =>
    quoteSaleReturn(
      sale,
      [{ saleLineId: id, productId: pid, quantity: quantity("piece", 1000n) }],
      [],
    ),
  ).toThrow();
  expect(() => quoteSaleReturn(sale, [...lines(), ...lines()], [])).toThrow();
});
it("refunds use original prices even when current product changes or is inactive", () => {
  const changed = createProduct({
    ...product,
    status: "inactive",
    salePrice: money(9999n),
  });
  expect(changed.salePrice.minorUnits).toBe(9999n);
  expect(quoteSaleReturn(sale, lines(), []).total.minorUnits).toBe(125n);
});
it("cumulative HALF-UP conserves two original cents across three fractions", () => {
  const p = createProduct({ ...product, unit: "kg", salePrice: money(500n) }),
    s = completeSale(
      addSaleProduct(createSaleDraft(id), p, quantity("kg", 3n)),
    );
  const selected = [
    { saleLineId: pid, productId: pid, quantity: quantity("kg", 1n) },
  ];
  const first = createSaleReturn(id, s, selected, [], refund(1n)),
    second = createSaleReturn(id, s, selected, [first], []),
    third = createSaleReturn(id, s, selected, [first, second], refund(1n));
  expect(
    first.total.minorUnits + second.total.minorUnits + third.total.minorUnits,
  ).toBe(s.total.minorUnits);
});
it("accepts exact card and mixed refund payments", () => {
  expect(
    createSaleReturn(id, sale, lines(), [], refund(125n, "card")).refunds[0]
      ?.method,
  ).toBe("card");
  expect(
    createSaleReturn(
      id,
      sale,
      lines(),
      [],
      [
        { method: "cash", amount: money(25n) },
        { method: "card", amount: money(100n) },
      ],
    ).total.minorUnits,
  ).toBe(125n);
  expect(() => createSaleReturn(id, sale, lines(), [], refund(124n))).toThrow();
});
it("method-specific accumulated refunds cannot exceed original tender", () => {
  const first = createSaleReturn(id, sale, lines(), [], refund(125n));
  expect(() =>
    assertRefundLimits(
      [
        { method: "cash", amount: money(200n) },
        { method: "card", amount: money(425n) },
      ],
      [first],
      refund(125n),
    ),
  ).toThrow(SaleReturnConflictError);
  expect(() =>
    assertRefundLimits(refund(625n), [], refund(1n, "card")),
  ).toThrow(SaleReturnConflictError);
});

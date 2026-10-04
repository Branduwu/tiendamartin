import { describe, it, expect } from "vitest";
import {
  money,
  quantity,
  createProduct,
  productId,
  productName,
  sku,
  createSaleDraft,
  addSaleProduct,
  discount,
  priceDiscountedSale,
  DiscountLimitError,
  couponCode,
  quoteSaleReturn,
  createSaleReturn,
  type SaleDraft,
} from "../src/index";
const ids = [
  "550e8400-e29b-41d4-a716-446655440101",
  "550e8400-e29b-41d4-a716-446655440102",
] as const;
function draft(price = 1000n, count = 1000n, second = false): SaleDraft {
  let s = createSaleDraft("550e8400-e29b-41d4-a716-446655440100");
  for (const id of second ? ids : [ids[0]])
    s = addSaleProduct(
      s,
      createProduct({
        id: productId(id),
        name: productName("Producto"),
        sku: sku(id === ids[0] ? "A" : "B"),
        unit: "piece",
        purchaseCost: money(0n),
        salePrice: money(price),
        status: "active",
      }),
      quantity("piece", count),
    );
  return s;
}
describe("exact discount pricing", () => {
  it("supports a fixed sale discount without mutating the original", () => {
    const s = draft();
    const q = priceDiscountedSale(s, { sale: discount("amount", 123n) });
    expect(q.sale.total.minorUnits).toBe(877n);
    expect(q.sale.lines[0]?.discount?.minorUnits).toBe(123n);
    expect(s.total.minorUnits).toBe(1000n);
  });
  it("rounds integer basis points HALF-UP including half a cent", () => {
    expect(
      priceDiscountedSale(draft(101n), { sale: discount("percentage", 5000n) })
        .sale.total.minorUnits,
    ).toBe(50n);
    expect(() => discount("percentage", 10001n)).toThrow();
    expect(() => discount("amount", -1n)).toThrow();
  });
  it("enforces the combined cashier 20% limit and its rounding boundary", () => {
    expect(
      priceDiscountedSale(
        draft(),
        { sale: discount("percentage", 2000n) },
        [],
        undefined,
        true,
      ).sale.total.minorUnits,
    ).toBe(800n);
    expect(() =>
      priceDiscountedSale(
        draft(),
        {
          sale: discount("percentage", 2000n),
          lines: [
            { productId: ids[0], discount: discount("percentage", 2000n) },
          ],
        },
        [],
        undefined,
        true,
      ),
    ).toThrow(DiscountLimitError);
    expect(() =>
      priceDiscountedSale(
        draft(3n),
        { sale: discount("percentage", 2000n) },
        [],
        undefined,
        true,
      ),
    ).toThrow(DiscountLimitError);
  });
  it("allows owner discounts above 20% and rejects negative resulting totals", () => {
    expect(
      priceDiscountedSale(draft(), { sale: discount("percentage", 7500n) }).sale
        .total.minorUnits,
    ).toBe(250n);
    expect(() =>
      priceDiscountedSale(draft(), { sale: discount("amount", 1001n) }),
    ).toThrow();
  });
  it("manual line discount replaces the automatic promotion", () => {
    const p = {
      id: ids[1],
      productId: ids[0],
      name: "Promo",
      discount: discount("percentage", 5000n),
    };
    const q = priceDiscountedSale(
      draft(),
      { lines: [{ productId: ids[0], discount: discount("amount", 100n) }] },
      [p],
    );
    expect(q.sale.total.minorUnits).toBe(900n);
    expect(q.details?.lines[0]?.source).toBe("manual");
  });
  it("applies fixed promotions per unit and chooses one best promotion", () => {
    const rules = [
      {
        id: ids[1],
        productId: ids[0],
        name: "Dos pesos",
        discount: discount("amount", 200n),
      },
      {
        id: ids[0],
        productId: ids[0],
        name: "Diez porciento",
        discount: discount("percentage", 1000n),
      },
    ];
    const q = priceDiscountedSale(draft(1000n, 2000n), {}, rules);
    expect(q.sale.total.minorUnits).toBe(1600n);
    expect(q.details?.lines[0]?.promotionName).toBe("Dos pesos");
  });
  it("applies coupon after line and manual sale discounts", () => {
    const q = priceDiscountedSale(
      draft(),
      {
        sale: discount("percentage", 1000n),
        lines: [{ productId: ids[0], discount: discount("amount", 100n) }],
        couponCode: " diez ",
      },
      [],
      { id: ids[1], code: "DIEZ", discount: discount("percentage", 1000n) },
    );
    expect(q.sale.total.minorUnits).toBe(729n);
    expect(q.details).toMatchObject({
      lineDiscountTotal: "100",
      saleDiscountTotal: "90",
      couponDiscountTotal: "81",
    });
    expect(couponCode(" diez ")).toBe("DIEZ");
  });
  it("allocates odd cents deterministically regardless of line order", () => {
    const s = draft(3n, 1000n, true),
      a = priceDiscountedSale(s, { sale: discount("amount", 1n) }),
      b = priceDiscountedSale(
        { ...s, lines: [...s.lines].reverse() },
        { sale: discount("amount", 1n) },
      );
    expect(a.sale.total.minorUnits).toBe(5n);
    expect(
      a.sale.lines.find((l) => l.productId === ids[0])?.lineTotal.minorUnits,
    ).toBe(2n);
    expect(
      b.sale.lines.find((l) => l.productId === ids[0])?.lineTotal.minorUnits,
    ).toBe(2n);
  });
  it("partial returns cumulatively conserve the discounted paid cents", () => {
    const q = priceDiscountedSale(draft(101n, 3000n), {
        sale: discount("amount", 102n),
      }),
      selection = [
        {
          saleLineId: ids[0],
          productId: ids[0],
          quantity: quantity("piece", 1000n),
        },
      ];
    const first = quoteSaleReturn(q.sale, selection, []);
    expect(first.total.minorUnits).toBe(67n);
    const r = createSaleReturn(
      ids[1],
      q.sale,
      selection,
      [],
      [{ method: "card", amount: first.total }],
    );
    const rest = quoteSaleReturn(
      q.sale,
      [{ ...selection[0]!, quantity: quantity("piece", 2000n) }],
      [r],
    );
    expect(first.total.minorUnits + rest.total.minorUnits).toBe(201n);
  });
  it("handles a free sale and rejects unknown or repeated manual lines", () => {
    const q = priceDiscountedSale(draft(), {
      sale: discount("percentage", 10000n),
    });
    expect(q.sale.total.minorUnits).toBe(0n);
    expect(
      quoteSaleReturn(
        q.sale,
        [
          {
            saleLineId: ids[0],
            productId: ids[0],
            quantity: quantity("piece", 1000n),
          },
        ],
        [],
      ).total.minorUnits,
    ).toBe(0n);
    expect(() =>
      priceDiscountedSale(draft(), {
        lines: [{ productId: ids[1], discount: discount("amount", 1n) }],
      }),
    ).toThrow();
    expect(() =>
      priceDiscountedSale(draft(), {
        lines: [
          { productId: ids[0], discount: discount("amount", 1n) },
          { productId: ids[0], discount: discount("amount", 1n) },
        ],
      }),
    ).toThrow();
  });
});

it("breaks saturated promotion ties by UUID after clamping the effective amount", () => {
  const rules = [1500n, 2000n].map((value, i) => ({
    id: ids[i]!,
    productId: ids[0],
    discount: discount("amount", value),
  }));
  expect(
    priceDiscountedSale(draft(), {}, rules).details?.lines[0]?.promotionId,
  ).toBe(ids[0]);
});

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProductDto } from "@smartretail/contracts";
import ProductLabel from "../app/components/product-label";
import { barcodeBars, barcodePattern } from "./barcode";
import {
  formatLabelPrice,
  labelItems,
  labelQuantity,
  labelQuery,
} from "./product-labels";

const tenantId = "10000000-0000-4000-8000-000000000001";
const product: ProductDto = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "Café",
  sku: "CAFE-1",
  barcode: "123456",
  unit: "piece",
  status: "active",
  purchaseCost: { currency: "MXN", minorUnits: "100" },
  salePrice: { currency: "MXN", minorUnits: "1250" },
};
const markup = (p = product, size: "small" | "standard" = "standard") =>
  renderToStaticMarkup(createElement(ProductLabel, { product: p, size }));

describe("label selection and exact display", () => {
  it("accepts empty query and a paired prefill", () => {
    expect(labelQuery({})).toEqual({});
    expect(labelQuery({ tenantId, productId: product.id })).toEqual({
      tenantId,
      productId: product.id,
    });
  });
  it("rejects repeated, malformed, unpaired and unexpected selectors", () => {
    for (const q of [
      { tenantId: [tenantId] },
      { tenantId: "bad" },
      { productId: product.id },
      { tenantId, extra: "value" },
    ])
      expect(labelQuery(q).error).toBeTruthy();
  });
  it("accepts canonical bounded copy counts", () => {
    expect(["1", "10", "100"].map(labelQuantity)).toEqual([1, 10, 100]);
  });
  it("rejects fractional, huge and noncanonical copy counts", () => {
    for (const count of [
      "0",
      "101",
      "-1",
      "1.5",
      "1e2",
      "01",
      " 1",
      "1\n",
      "",
      "9".repeat(500),
    ])
      expect(() => labelQuantity(count)).toThrow();
  });
  it("makes the requested copies without mutating products", () => {
    const p = Object.freeze({ ...product });
    const other = { ...product, id: "20000000-0000-4000-8000-000000000002" };
    const items = labelItems(
      [p, other],
      [
        { productId: p.id, quantity: 10 },
        { productId: other.id, quantity: 4 },
      ],
    );
    expect(items).toHaveLength(14);
    expect(items[9]).toEqual({ product: p, copy: 10 });
    expect(items[10]).toEqual({ product: other, copy: 1 });
    expect(p).toEqual(product);
  });
  it("rejects unavailable and duplicate selections", () => {
    expect(() =>
      labelItems([], [{ productId: product.id, quantity: 1 }]),
    ).toThrow();
    expect(() =>
      labelItems(
        [product],
        [
          { productId: product.id, quantity: 1 },
          { productId: product.id, quantity: 1 },
        ],
      ),
    ).toThrow();
  });
  it("enforces the total print bound and invalid numeric counts", () => {
    const others = [product, { ...product, id: "b" }, { ...product, id: "c" }];
    expect(
      labelItems(
        others,
        others.slice(0, 2).map((p) => ({ productId: p.id, quantity: 100 })),
      ),
    ).toHaveLength(200);
    expect(() =>
      labelItems(
        others,
        others.map((p) => ({ productId: p.id, quantity: 100 })),
      ),
    ).toThrow();
    for (const quantity of [NaN, Infinity, 1.5, 0, 101])
      expect(() =>
        labelItems([product], [{ productId: product.id, quantity }]),
      ).toThrow();
  });
  it("displays MXN cents exactly including values beyond safe integer", () => {
    expect(formatLabelPrice("0")).toBe("$0.00 MXN");
    expect(formatLabelPrice("1")).toBe("$0.01 MXN");
    expect(formatLabelPrice("1250")).toBe("$12.50 MXN");
    expect(formatLabelPrice("9007199254740993123")).toBe(
      "$90071992547409931.23 MXN",
    );
  });
  it("rejects invalid monetary representations", () => {
    for (const value of ["01", "1.5", "-1", "1e3"])
      expect(() => formatLabelPrice(value)).toThrow();
  });
});

describe("CODE128 labels", () => {
  it("encodes a known numeric vector including start, checksum and stop", () => {
    expect(barcodePattern("123456")).toBe(
      "11010011100101100111001000101100011100010110100011011101100011101011",
    );
  });
  it("preserves leading zeros and distinguishes stored values", () => {
    expect(barcodePattern("001234")).not.toBe(barcodePattern("1234"));
    expect(markup({ ...product, barcode: "001234" })).toContain(
      'data-encoded-value="001234"',
    );
  });
  it("supports product ASCII punctuation without generating HTML", () => {
    expect(barcodePattern("A<&>~!")).toMatch(/^[01]+$/);
    expect(markup({ ...product, barcode: "<tag>" })).toContain("&lt;tag&gt;");
    expect(markup({ ...product, barcode: "<tag>" })).not.toContain("<tag>");
  });
  it("rejects unsupported characters, empty and oversized values", () => {
    for (const value of ["", "ABC\n", "A B", "ñ", "\u0000", "A".repeat(129)])
      expect(() => barcodePattern(value)).toThrow();
  });
  it("renders runs with a ten-module quiet zone", () => {
    expect(barcodeBars("110100111")).toEqual([
      { x: 10, width: 2 },
      { x: 13, width: 1 },
      { x: 16, width: 3 },
    ]);
    for (const bits of ["", "10x", "10\n", "1".repeat(2001)])
      expect(() => barcodeBars(bits)).toThrow();
  });
  it("renders stored name, SKU, sale price and accessible barcode", () => {
    const html = markup();
    expect(html).toContain("Café");
    expect(html).toContain("SKU: CAFE-1");
    expect(html).toContain("$12.50 MXN");
    expect(html).toContain('role="img"');
    expect(html).toContain('data-encoded-value="123456"');
    expect(html).not.toContain(product.id);
  });
  it("clearly identifies missing barcode without empty bars", () => {
    const { barcode: _barcode, ...p } = product;
    expect(_barcode).toBe("123456");
    const html = markup(p);
    expect(html).toContain("Sin código de barras");
    expect(html).not.toContain("<svg");
  });
  it("refuses to squeeze long codes into unreadably thin bars", () => {
    const p = { ...product, barcode: "A".repeat(128) };
    for (const size of ["small", "standard"] as const) {
      expect(markup(p, size)).toContain("Código demasiado largo");
      expect(markup(p, size)).not.toContain("<svg");
      expect(markup(p, size)).toContain(p.barcode);
    }
  });
  it("supports both print sizes with barcode dimensions", () => {
    expect(markup(product, "small")).toContain("product-label-small");
    expect(markup(product, "small")).toContain("height:8mm");
    expect(markup(product)).toContain("product-label-standard");
    expect(markup(product)).toContain("height:12mm");
  });
  it("escapes hostile name and SKU as plain text", () => {
    const html = markup({
      ...product,
      name: '<img src=x onerror="alert(1)">',
      sku: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
  });
  it("marks unexpected unrepresentable barcode without bars", () => {
    expect(markup({ ...product, barcode: "é" })).toContain(
      "Código no representable",
    );
    expect(markup({ ...product, barcode: "é" })).not.toContain("<svg");
  });
});

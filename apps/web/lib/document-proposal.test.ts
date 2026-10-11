import { describe, expect, it } from "vitest";
import {
  detectedAmount,
  documentDecimal,
  documentWarnings,
  proposeDocument,
  proposedLineTotal,
  suggestProducts,
} from "./document-proposal";

const fixture = `PROVEEDOR: SMOKE Distribuidora
FOLIO: SMOKE-001
FECHA: 2026-10-10
MONEDA: MXN
Arroz | 2 | kg | 25.50 | 51.00
Azucar | 3 | piece | 10.00 | 30.00
SUBTOTAL: 81.00
IMPUESTOS: 0.00
TOTAL: 81.00`;
it("does not mistake a package size in the name for the ordered quantity", () => {
  const line = proposeDocument("2 pzas Agua 600 ml 10.00 20.00").lines[0];
  expect(line?.description).toBe("Agua 600 ml");
  expect(line?.quantity.value).toBe("2000");
  expect(line?.unit).toBe("piece");
});
it("prefers a recognized unit to digits in a brand name", () => {
  const line = proposeDocument("7 UP 2 pzas 10.00 20.00").lines[0];
  expect(line?.description).toBe("7 UP");
  expect(line?.quantity.value).toBe("2000");
  expect(line?.unit).toBe("piece");
});
it("marks competing quantities with unknown units for human review", () => {
  const line = proposeDocument("2 cajas Agua 600 botellas 10.00 20.00")
    .lines[0];
  expect(line?.quantity.value).toBeNull();
  expect(line?.quantity.state).toBe("Revisar");
  expect(line?.unit).toBeNull();
});
it("retains original row numbering after the reviewer ignores a line", () => {
  const value = proposeDocument(fixture);
  value.lines = [{ ...value.lines[1]!, cost: detectedAmount("12.00") }];
  expect(documentWarnings(value, [2])[0]).toMatch(/^Línea 2:/);
});
describe("document proposals, never financial commands", () => {
  it.each([
    ["$1,234.56", "1234.56"],
    ["1 234,56", "1234.56"],
    ["1.234,56", "1234.56"],
    ["25.50", "25.50"],
    ["0", "0"],
  ])("parses exact money %s", (raw, expected) =>
    expect(documentDecimal(raw, 2)).toBe(expected),
  );
  it.each([
    "1,234",
    "1.234",
    "1e3",
    "-1",
    "01",
    "12,34.56",
    "1,00,000",
    "NaN",
    "1.0000",
    "<script>",
    "9".repeat(129),
  ])("does not guess %s", (raw) => expect(documentDecimal(raw, 2)).toBeNull());
  it("keeps absent and ambiguous fields distinct", () => {
    expect(detectedAmount("").state).toBe("No identificado");
    expect(detectedAmount("1,234").state).toBe("Revisar");
    expect(detectedAmount("1.50", true).value).toBe("1500");
  });
  it("extracts fictitious supplier, document and exact lines", () => {
    const p = proposeDocument(fixture);
    expect([p.supplier, p.reference, p.date, p.currency]).toEqual([
      "SMOKE Distribuidora",
      "SMOKE-001",
      "2026-10-10",
      "MXN",
    ]);
    expect(p.lines[0]?.cost.value).toBe("2550");
    expect(p.lines[0]?.quantity.value).toBe("2000");
    expect(documentWarnings(p)).toEqual([]);
  });
  it("never invents absent amounts or currency", () => {
    const p = proposeDocument("A note without structured data");
    expect(p.lines).toEqual([]);
    expect(p.total.value).toBeNull();
    expect(p.currency).toBe("");
  });
  it.each([
    "Arroz blanco 2 pzas 25.50 51.00",
    "2 pzas Arroz blanco 25.50 51.00",
  ])("proposes common unruled ticket rows: %s", (text) => {
    const p = proposeDocument(text);
    expect(p.lines[0]?.description).toBe("Arroz blanco");
    expect(p.lines[0]?.quantity.value).toBe("2000");
    expect(p.lines[0]?.cost.value).toBe("2550");
  });
  it("warns without fixing conflicting totals", () => {
    const p = proposeDocument(
      fixture.replace(/\nTOTAL: 81.00$/, "\nTOTAL: 130.00"),
    );
    expect(documentWarnings(p)).toContain(
      "Subtotal e impuestos no coinciden con el total detectado.",
    );
    expect(p.total.value).toBe("13000");
  });
  it("flags unknown units and inconsistent line amounts", () => {
    const p = proposeDocument(
      fixture.replace("2 | kg | 25.50 | 51.00", "2 | cajas | 25.50 | 52.00"),
    );
    expect(p.lines[0]?.unit).toBeNull();
    expect(documentWarnings(p)).toHaveLength(2);
  });
  it("rounds exact quantity times minor units HALF-UP", () => {
    expect(proposedLineTotal("1500", "1")).toBe(2n);
    expect(proposedLineTotal("1000", "9999999999999999999")).toBe(
      9999999999999999999n,
    );
  });
  it("prioritizes barcode, then SKU, while excluding inactive products", () => {
    const line = { ...proposeDocument(fixture).lines[0]!, code: "EXACT" };
    const products = [
      { name: "Other", sku: "EXACT", barcode: "123", status: "active" },
      { name: "Barcode", sku: "BAR", barcode: "EXACT", status: "active" },
      { name: "Inactive", sku: "X", barcode: "EXACT", status: "inactive" },
    ];
    expect(suggestProducts(line, products).map((p) => p.name)).toEqual([
      "Barcode",
    ]);
    expect(
      suggestProducts(line, products.slice(0, 1)).map((p) => p.name),
    ).toEqual(["Other"]);
  });
  it("leaves multiple name matches as suggestions, never a selection", () => {
    const line = proposeDocument(fixture).lines[0]!;
    expect(
      suggestProducts(line, [
        { name: "Arroz blanco", sku: "A", status: "active" },
        { name: "Arroz integral", sku: "B", status: "active" },
      ]),
    ).toHaveLength(2);
    expect(
      suggestProducts(line, [{ name: "Otro", sku: "C", status: "active" }]),
    ).toEqual([]);
  });
  it("treats hostile document content only as text", () => {
    const p = proposeDocument(
      "PROVEEDOR: <script>alert(1)</script>\nDROP TABLE | 1 | piece | 2 | 2",
    );
    expect(p.supplier).toBe("<script>alert(1)</script>");
    expect(p.lines[0]?.description).toBe("DROP TABLE");
  });
  it("bounds document text before parsing", () =>
    expect(() => proposeDocument("x".repeat(100001))).toThrow());
});

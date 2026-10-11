import { expect, it } from "vitest";
import type { ProductDto, PurchaseOrderDto } from "@smartretail/contracts";
import { proposeDocument } from "./document-proposal";
import {
  documentIdentity,
  possibleDuplicate,
  reviewedDraft,
  reviewedAmount,
  type ReviewLine,
} from "./document-review";
const id = "550e8400-e29b-41d4-a716-446655440010";
const product: ProductDto = {
  id,
  name: "SMOKE Arroz",
  sku: "SMOKE",
  unit: "piece",
  status: "active",
  purchaseCost: { currency: "MXN", minorUnits: "100" },
  salePrice: { currency: "MXN", minorUnits: "200" },
};
const p = proposeDocument(
  "MONEDA: MXN\nArroz | 2 | piece | 1.00 | 2.00\nTOTAL: 2.00\nFOLIO: SMOKE-001\nFECHA: 2026-10-10",
);
const line: ReviewLine = {
  proposal: p.lines[0]!,
  productId: id,
  quantity: "2",
  cost: "1.00",
  unit: "piece",
  confirmed: true,
  ignored: false,
};
const create = (l: ReviewLine[] = [line], products = [product]) =>
  reviewedDraft(id, id, id, p, l, products);
it("manual canonical quantities retain math warnings without OCR ambiguity", () => {
  expect(reviewedAmount("2.000", true).value).toBe("2000");
  expect(reviewedAmount("1,234", true).value).toBeNull();
});
it("creates only an exact draft after human product confirmation", () => {
  const draft = create();
  expect(draft.lines[0]?.unitCost.minorUnits).toBe("100");
  expect(draft.lines[0]?.quantityOrdered.milliUnits).toBe("2000");
  expect(draft).not.toHaveProperty("receipt");
  expect(documentIdentity(draft.notes)?.reference).toBe("SMOKE-001");
});
it("requires confirmation, current active product and matching unit", () => {
  expect(() => create([{ ...line, confirmed: false }])).toThrow();
  expect(() => create([line], [{ ...product, status: "inactive" }])).toThrow();
  expect(() => create([{ ...line, unit: "kg" }])).toThrow();
});
it("requires exact positive quantity and nonnegative money", () => {
  expect(() => create([{ ...line, quantity: "0" }])).toThrow();
  expect(() => create([{ ...line, quantity: "1.5" }])).toThrow();
  expect(() => create([{ ...line, cost: "-1" }])).toThrow();
});
it("ignores a line only explicitly and rejects an empty purchase", () => {
  expect(create([line, { ...line, ignored: true }]).lines).toHaveLength(1);
  expect(() => create([{ ...line, ignored: true }])).toThrow();
});
it("does not infer absent currency", () =>
  expect(() =>
    reviewedDraft(id, id, id, { ...p, currency: "" }, [line], [product]),
  ).toThrow());
it("duplicate matching requires supplier plus all document identity fields", () => {
  const draft = create();
  const order: PurchaseOrderDto = {
    ...draft,
    tenantId: id,
    createdBy: id,
    createdAt: "2026-10-10T00:00:00Z",
    status: "draft",
    lines: draft.lines.map((l) => ({
      ...l,
      quantityReceived: { unit: "piece", milliUnits: "0" },
    })),
  };
  const identity = documentIdentity(draft.notes)!;
  expect(possibleDuplicate([order], id, identity)).toBe(true);
  expect(possibleDuplicate([order], "other", identity)).toBe(false);
  expect(possibleDuplicate([order], id, { ...identity, date: "" })).toBe(false);
  expect(possibleDuplicate([order], id, { ...identity, total: "999" })).toBe(
    false,
  );
});
it("malformed notes and hostile object keys never become executable metadata", () => {
  expect(documentIdentity("Documento revisado: null")).toBeNull();
  expect(documentIdentity("Documento revisado: <script>")).toBeNull();
});

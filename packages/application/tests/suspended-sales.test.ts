import { expect, it } from "vitest";
import {
  createProduct,
  productId,
  productName,
  sku,
  money,
  quantity,
  createSaleDraft,
} from "@smartretail/domain";
import {
  scanSaleProduct,
  rebuildSuspendedSale,
  suspensionCommand,
  type SuspendedSale,
} from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440001",
  pid = "550e8400-e29b-41d4-a716-446655440002";
const product = createProduct({
  id: productId(pid),
  name: productName("Test"),
  sku: sku("TEST"),
  unit: "piece",
  status: "active",
  purchaseCost: money(0n),
  salePrice: money(100n),
});
const record: SuspendedSale = {
  id,
  locationId: pid,
  tenantId: pid,
  createdBy: pid,
  createdAt: "2026-10-02T12:00:00Z",
  status: "suspended",
  lines: [{ productId: pid, quantity: quantity("piece", 2000n) }],
};
it("each keyboard scan adds exactly one piece, including repeats", () => {
  const first = scanSaleProduct(createSaleDraft(id), product);
  expect(first.lines[0]?.quantity.milliUnits).toBe(1000n);
  expect(scanSaleProduct(first, product).lines[0]?.quantity.milliUnits).toBe(
    2000n,
  );
  expect(first.lines[0]?.quantity.milliUnits).toBe(1000n);
});
it("all six fractional units require explicit quantity", () => {
  for (const unit of ["kg", "g", "l", "ml", "m", "cm"] as const) {
    const p = createProduct({ ...product, unit });
    expect(() => scanSaleProduct(createSaleDraft(id), p)).toThrow(
      "Explicit quantity",
    );
    expect(
      scanSaleProduct(createSaleDraft(id), p, quantity(unit, 125n)).lines[0]
        ?.quantity.milliUnits,
    ).toBe(125n);
  }
});
it("inactive scans cannot modify draft", () => {
  const draft = createSaleDraft(id);
  expect(() =>
    scanSaleProduct(draft, createProduct({ ...product, status: "inactive" })),
  ).toThrow();
  expect(draft.lines).toHaveLength(0);
});
it("rebuilds a current quote and rejects changed unit/inactive/closed cart", () => {
  expect(
    rebuildSuspendedSale(
      record,
      [createProduct({ ...product, salePrice: money(333n) })],
      id,
    ).total.minorUnits,
  ).toBe(666n);
  for (const p of [
    createProduct({ ...product, unit: "kg" }),
    createProduct({ ...product, status: "inactive" }),
  ])
    expect(() => rebuildSuspendedSale(record, [p], id)).toThrow();
  expect(() =>
    rebuildSuspendedSale({ ...record, status: "cancelled" }, [product], id),
  ).toThrow();
});
it("normalizes retries without prices and rejects duplicate/fractional piece lines", () => {
  expect(suspensionCommand(record).payload).not.toContain("price");
  expect(() =>
    suspensionCommand({ ...record, lines: [...record.lines, ...record.lines] }),
  ).toThrow();
  expect(() =>
    suspensionCommand({
      ...record,
      lines: [{ productId: pid, quantity: quantity("piece", 1n) }],
    }),
  ).toThrow();
});

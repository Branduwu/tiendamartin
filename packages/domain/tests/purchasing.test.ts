import { describe, it, expect } from "vitest";
import {
  supplierFields,
  purchaseDraft,
  receivePurchase,
  purchaseReceipt,
  PurchaseConflictError,
  productId,
  money,
  quantity,
  type PurchaseOrder,
} from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440001";
const line = {
  productId: productId(id),
  quantityOrdered: quantity("piece", 10000n),
  unitCost: money(777n),
};
const draft = { id, supplierId: id, locationId: id, lines: [line] };
const ordered: PurchaseOrder = {
  ...draft,
  tenantId: id,
  createdBy: id,
  createdAt: "2026-10-02T00:00:00.000Z",
  orderedAt: "2026-10-02T01:00:00.000Z",
  status: "ordered",
  lines: [{ ...line, quantityReceived: quantity("piece", 0n) }],
};
describe("purchasing foundations", () => {
  it("snapshots supplier fields and rejects blank or excessive values", () => {
    expect(supplierFields({ name: "  Supply  ", status: "active" }).name).toBe(
      "Supply",
    );
    expect(() => supplierFields({ name: " ", status: "active" })).toThrow();
    expect(() =>
      supplierFields({ name: "x".repeat(201), status: "active" }),
    ).toThrow();
  });
  it("requires unique positive whole-piece lines and nonnegative costs", () => {
    expect(() => purchaseDraft({ ...draft, lines: [line, line] })).toThrow();
    expect(() =>
      purchaseDraft({
        ...draft,
        lines: [{ ...line, quantityOrdered: quantity("piece", 1n) }],
      }),
    ).toThrow();
    expect(() =>
      purchaseDraft({ ...draft, lines: [{ ...line, unitCost: money(-1n) }] }),
    ).toThrow();
    expect(() => purchaseDraft({ ...draft, lines: [] })).toThrow();
  });
  it("partial and full receipt are exact and do not mutate operands", () => {
    const partial = receivePurchase(ordered, {
      id,
      lines: [
        { productId: line.productId, quantity: quantity("piece", 4000n) },
      ],
    });
    expect(partial.status).toBe("partially_received");
    expect(
      receivePurchase(partial, {
        id,
        lines: [
          { productId: line.productId, quantity: quantity("piece", 6000n) },
        ],
      }).status,
    ).toBe("received");
    expect(ordered.lines[0]?.quantityReceived.milliUnits).toBe(0n);
    expect(partial.lines[0]?.unitCost.minorUnits).toBe(777n);
  });
  it("fractional units keep thousandths and very large bigint exact", () => {
    const kg = {
      ...ordered,
      lines: [
        {
          ...line,
          quantityOrdered: quantity("kg", 9007199254740993001n),
          quantityReceived: quantity("kg", 0n),
        },
      ],
    };
    const next = receivePurchase(kg, {
      id,
      lines: [{ productId: line.productId, quantity: quantity("kg", 125n) }],
    });
    expect(next.lines[0]?.quantityReceived.milliUnits).toBe(125n);
  });
  it("rejects terminal states, over-receive and unit mismatches", () => {
    const incoming = {
      id,
      lines: [
        { productId: line.productId, quantity: quantity("piece", 11000n) },
      ],
    };
    expect(() => receivePurchase(ordered, incoming)).toThrow(
      PurchaseConflictError,
    );
    expect(() =>
      receivePurchase(
        { ...ordered, status: "cancelled" },
        {
          ...incoming,
          lines: [
            { productId: line.productId, quantity: quantity("piece", 1000n) },
          ],
        },
      ),
    ).toThrow();
    expect(() =>
      receivePurchase(ordered, {
        id,
        lines: [{ productId: line.productId, quantity: quantity("kg", 1n) }],
      }),
    ).toThrow();
  });
  it("canonical receipt order rejects duplicates and number quantities", () => {
    expect(() =>
      purchaseReceipt({
        id,
        lines: [
          { productId: line.productId, quantity: quantity("piece", 1000n) },
          { productId: line.productId, quantity: quantity("piece", 1000n) },
        ],
      }),
    ).toThrow();
    expect(() => quantity("piece", 1000 as unknown as bigint)).toThrow();
  });
});

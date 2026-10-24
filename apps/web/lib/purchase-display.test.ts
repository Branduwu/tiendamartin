import { describe, expect, it } from "vitest";
import {
  filterPurchases,
  emptyPurchaseFilters,
  purchaseAmount,
  purchaseLineAmount,
  purchaseReference,
  purchaseDate,
  purchaseStatusText,
} from "./purchase-display";
import type { PurchaseOrderDto, SupplierDto } from "@smartretail/contracts";
const order = (changes: Partial<PurchaseOrderDto> = {}): PurchaseOrderDto => ({
  id: "550e8400-e29b-41d4-a716-446655440001",
  tenantId: "tenant",
  supplierId: "supplier",
  locationId: "location",
  createdBy: "actor",
  createdAt: "2026-10-24T05:30:00Z",
  status: "ordered",
  lines: [
    {
      productId: "product",
      quantityOrdered: { unit: "kg", milliUnits: "1500" },
      quantityReceived: { unit: "kg", milliUnits: "0" },
      unitCost: { currency: "MXN", minorUnits: "101" },
    },
  ],
  ...changes,
});
const suppliers = [
  { id: "supplier", name: "Café del Centro", status: "active" },
] as SupplierDto[];
describe("purchase display only", () => {
  it("rounds half up per line consistently with payable SQL", () =>
    expect(purchaseAmount(order())).toBe("1.52"));
  it("sums rounded lines rather than rounding the aggregate", () => {
    const o = order();
    o.lines = [...o.lines, ...o.lines];
    expect(purchaseAmount(o)).toBe("3.04");
  });
  it("does not confuse ordered and received amounts", () => {
    const o = order();
    o.lines[0]!.quantityReceived.milliUnits = "500";
    expect(purchaseAmount(o)).toBe("1.52");
  });
  it("preserves integers beyond Number precision", () => {
    const o = order();
    o.lines[0]!.unitCost.minorUnits = "9007199254740993";
    o.lines[0]!.quantityOrdered.milliUnits = "1000";
    expect(purchaseAmount(o)).toBe("90071992547409.93");
  });
  it("supports zero cost", () => {
    const o = order();
    o.lines[0]!.unitCost.minorUnits = "0";
    expect(purchaseLineAmount(o.lines[0]!)).toBe(0n);
  });
  it("uses document folio without inventing one", () =>
    expect(
      purchaseReference(
        order({
          notes:
            'Documento revisado: {"reference":"FAC-42","date":"2026-10-23","total":"1.52"}',
        }),
      ),
    ).toBe("FAC-42"));
  it("falls back to a labelled order reference for manual orders", () =>
    expect(purchaseReference(order())).toBe("OC-550E8400"));
  it("ignores malformed document metadata safely", () =>
    expect(purchaseReference(order({ notes: "Documento revisado: {" }))).toBe(
      "OC-550E8400",
    ));
  it("searches supplier case/accent insensitive with multiple terms", () =>
    expect(
      filterPurchases([order()], suppliers, {
        ...emptyPurchaseFilters,
        query: "CAFE centro",
      }),
    ).toHaveLength(1));
  it("searches full order id and notes", () => {
    expect(
      filterPurchases([order()], suppliers, {
        ...emptyPurchaseFilters,
        query: "446655440001",
      }),
    ).toHaveLength(1);
    expect(
      filterPurchases([order({ notes: "Entrega semanal" })], suppliers, {
        ...emptyPurchaseFilters,
        query: "semanal",
      }),
    ).toHaveLength(1);
  });
  it("combines provider and status without changing input", () => {
    const o = order();
    expect(
      filterPurchases([o], suppliers, {
        ...emptyPurchaseFilters,
        supplier: "other",
      }),
    ).toHaveLength(0);
    expect(
      filterPurchases([o], suppliers, {
        ...emptyPurchaseFilters,
        status: "received",
      }),
    ).toHaveLength(0);
    expect(o.status).toBe("ordered");
  });
  it("uses Mexico City calendar date near UTC midnight", () =>
    expect(purchaseDate(order().createdAt)).toBe("2026-10-23"));
  it("includes both date boundaries", () =>
    expect(
      filterPurchases([order()], suppliers, {
        ...emptyPurchaseFilters,
        from: "2026-10-23",
        to: "2026-10-23",
      }),
    ).toHaveLength(1));
  it("excludes outside date range", () =>
    expect(
      filterPurchases([order()], suppliers, {
        ...emptyPurchaseFilters,
        from: "2026-10-24",
      }),
    ).toHaveLength(0));
  it("keeps order supplied by server", () => {
    const list = [order(), order({ id: "second" })];
    expect(
      filterPurchases(list, suppliers, emptyPurchaseFilters).map((o) => o.id),
    ).toEqual(list.map((o) => o.id));
  });
  it("labels every existing state in Spanish", () =>
    expect(Object.keys(purchaseStatusText)).toEqual([
      "draft",
      "ordered",
      "partially_received",
      "received",
      "cancelled",
    ]));
});

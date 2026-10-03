import { describe, expect, it } from "vitest";
import type { ProductDto, InventoryLocationDto } from "@smartretail/contracts";
import { replenishmentPath, trustedPurchasePrefill } from "./purchase-prefill";

const request = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  productId: "22222222-2222-4222-8222-222222222222",
  locationId: "33333333-3333-4333-8333-333333333333",
};
const products = [
  { id: request.productId, status: "active", unit: "kg" },
] as ProductDto[];
const locations = [
  { id: request.locationId, status: "active" },
] as InventoryLocationDto[];
const response = (milliUnits = "1234", unit = "kg") => ({
  ...request,
  quantityOrdered: { milliUnits, unit },
});
describe("trusted replenishment UI prefill", () => {
  it("requests only product/location selectors, with no URL quantity or tenant query", () => {
    const query = new URL(replenishmentPath(request), "https://example.test")
      .searchParams;
    expect([...query.keys()]).toEqual(["productId", "locationId"]);
    expect(query.get("productId")).toBe(request.productId);
    expect(query.get("locationId")).toBe(request.locationId);
  });
  it("keeps decimal quantities exact above Number precision", () => {
    expect(
      trustedPurchasePrefill(
        response("9007199254740993"),
        request,
        products,
        locations,
      ).amount,
    ).toBe("9007199254740.993");
    expect(
      trustedPurchasePrefill(response(), request, products, locations),
    ).toEqual({
      productId: request.productId,
      locationId: request.locationId,
      amount: "1.234",
    });
  });
  it("rejects mismatched tenant, product or location", () => {
    for (const field of ["tenantId", "productId", "locationId"] as const) {
      expect(() =>
        trustedPurchasePrefill(
          { ...response(), [field]: "44444444-4444-4444-8444-444444444444" },
          request,
          products,
          locations,
        ),
      ).toThrow();
    }
  });
  it("rejects unusable quantities without coercion", () => {
    for (const value of ["0", "-1", "01", "1.5", "9223372036854775808"]) {
      expect(() =>
        trustedPurchasePrefill(response(value), request, products, locations),
      ).toThrow();
    }
  });
  it("rejects missing, inactive and incompatible references", () => {
    expect(() =>
      trustedPurchasePrefill(response(), request, [], locations),
    ).toThrow();
    expect(() =>
      trustedPurchasePrefill(response(), request, products, []),
    ).toThrow();
    expect(() =>
      trustedPurchasePrefill(
        response(),
        request,
        products.map((p) => ({ ...p, status: "inactive" })),
        locations,
      ),
    ).toThrow();
    expect(() =>
      trustedPurchasePrefill(
        response(),
        request,
        products,
        locations.map((l) => ({ ...l, status: "inactive" })),
      ),
    ).toThrow();
    expect(() =>
      trustedPurchasePrefill(
        response("1000", "piece"),
        request,
        products,
        locations,
      ),
    ).toThrow();
  });
  it("requires whole pieces", () => {
    const pieces = products.map((p) => ({ ...p, unit: "piece" as const }));
    expect(() =>
      trustedPurchasePrefill(
        response("1500", "piece"),
        request,
        pieces,
        locations,
      ),
    ).toThrow();
    expect(
      trustedPurchasePrefill(
        response("2000", "piece"),
        request,
        pieces,
        locations,
      ).amount,
    ).toBe("2.000");
  });
  it("rejects malformed responses", () => {
    for (const value of [
      null,
      {},
      {
        ...response(),
        quantityOrdered: { unit: "unknown", milliUnits: "1000" },
      },
    ])
      expect(() =>
        trustedPurchasePrefill(value, request, products, locations),
      ).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  SaleIdSchema,
  SaleLineSchema,
  SaleSchema,
  SaleDraftSchema,
  CompletedSaleSchema,
} from "../src/index";

const id = "550e8400-e29b-41d4-a716-446655440001";
const line = () => ({
  productId: "550e8400-e29b-41d4-a716-446655440002",
  sku: "TEST",
  name: "Product",
  unit: "kg",
  quantity: { unit: "kg", milliUnits: "500" },
  unitPrice: { currency: "MXN", minorUnits: "1" },
  lineTotal: { currency: "MXN", minorUnits: "1" },
});
const draft = () => ({
  id,
  status: "draft",
  lines: [line()],
  total: { currency: "MXN", minorUnits: "1" },
});

describe("sale contracts", () => {
  it("accepts serializable snapshots and distinguishes draft/completed", () => {
    expect(SaleDraftSchema.parse(draft()).status).toBe("draft");
    expect(
      CompletedSaleSchema.parse({ ...draft(), status: "completed" }).status,
    ).toBe("completed");
    expect(CompletedSaleSchema.safeParse(draft()).success).toBe(false);
    expect(JSON.parse(JSON.stringify(SaleSchema.parse(draft())))).toEqual(
      draft(),
    );
  });
  it("accepts only an empty draft with zero total", () => {
    const empty = {
      ...draft(),
      lines: [],
      total: { currency: "MXN", minorUnits: "0" },
    };
    expect(SaleSchema.safeParse(empty).success).toBe(true);
    expect(
      SaleSchema.safeParse({ ...empty, status: "completed" }).success,
    ).toBe(false);
    expect(
      SaleSchema.safeParse({ ...empty, total: draft().total }).success,
    ).toBe(false);
  });
  it("validates SaleId including exact UUID length", () => {
    expect(SaleIdSchema.safeParse(id).success).toBe(true);
    expect(SaleIdSchema.safeParse(id + "\n").success).toBe(false);
    expect(SaleIdSchema.safeParse(123).success).toBe(false);
  });
  it("rejects unknown fields at envelope, line, Money and Quantity levels", () => {
    const value = draft();
    for (const input of [
      { ...value, paid: true },
      { ...value, lines: [{ ...line(), product: {} }] },
      { ...value, total: { ...value.total, extra: true } },
      {
        ...value,
        lines: [{ ...line(), quantity: { ...line().quantity, extra: true } }],
      },
    ])
      expect(SaleSchema.safeParse(input).success).toBe(false);
  });
  it.each(["0", "-1", "01", "1.5", 1000, 1000n])(
    "rejects nonpositive/noncanonical/coerced quantity %s safely",
    (input) => {
      expect(
        SaleLineSchema.safeParse({
          ...line(),
          quantity: { unit: "kg", milliUnits: input },
        }).success,
      ).toBe(false);
    },
  );
  it("rejects signed/noninteger/coerced money without throwing a BigInt parsing exception", () => {
    for (const amount of ["-1", "1.5", "1e3", "01", "-0", "", 1, 1n]) {
      expect(
        SaleLineSchema.safeParse({
          ...line(),
          unitPrice: { currency: "MXN", minorUnits: amount },
        }).success,
      ).toBe(false);
      expect(
        SaleSchema.safeParse({
          ...draft(),
          total: { currency: "MXN", minorUnits: amount },
        }).success,
      ).toBe(false);
    }
  });
  it("rejects unit mismatches and tampered HALF-UP line totals", () => {
    expect(SaleLineSchema.safeParse({ ...line(), unit: "piece" }).success).toBe(
      false,
    );
    expect(
      SaleLineSchema.safeParse({
        ...line(),
        lineTotal: { currency: "MXN", minorUnits: "0" },
      }).success,
    ).toBe(false);
  });
  it("rejects duplicate product IDs regardless of case and a forged sale total", () => {
    expect(
      SaleSchema.safeParse({
        ...draft(),
        lines: [
          line(),
          { ...line(), productId: line().productId.toUpperCase() },
        ],
        total: { currency: "MXN", minorUnits: "2" },
      }).success,
    ).toBe(false);
    expect(
      SaleSchema.safeParse({
        ...draft(),
        total: { currency: "MXN", minorUnits: "2" },
      }).success,
    ).toBe(false);
  });
  it("enforces technical integer/line limits before arithmetic/line parsing", () => {
    expect(
      SaleLineSchema.safeParse({
        ...line(),
        unitPrice: { currency: "MXN", minorUnits: "9".repeat(129) },
      }).success,
    ).toBe(false);
    expect(
      SaleSchema.safeParse({
        ...draft(),
        lines: Array.from({ length: 1001 }, () => null),
      }).success,
    ).toBe(false);
  });
});

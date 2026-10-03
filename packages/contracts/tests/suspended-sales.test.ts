import { expect, it } from "vitest";
import { SuspendSaleSchema, CheckoutSchema } from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440001";
const input = {
  id,
  locationId: id,
  lines: [{ productId: id, quantity: { unit: "piece", milliUnits: "1000" } }],
};
it("accepts exact serializable quantities without quote or payments", () => {
  expect(SuspendSaleSchema.parse(input)).toEqual(input);
});
it("rejects extra identity, price and payment authority", () => {
  for (const extra of [
    { role: "owner" },
    { createdBy: id },
    { payments: [] },
    { price: "100" },
  ])
    expect(SuspendSaleSchema.safeParse({ ...input, ...extra }).success).toBe(
      false,
    );
  expect(
    SuspendSaleSchema.safeParse({
      ...input,
      lines: [{ ...input.lines[0], unitPrice: "10" }],
    }).success,
  ).toBe(false);
});
it("rejects wrong, nonpositive, fractional piece and noncanonical quantities", () => {
  for (const value of [
    0,
    1000,
    "0",
    "-1",
    "01",
    "1e3",
    "1.0",
    " 1000",
    "1",
    "1".repeat(129),
  ])
    expect(
      SuspendSaleSchema.safeParse({
        ...input,
        lines: [
          { productId: id, quantity: { unit: "piece", milliUnits: value } },
        ],
      }).success,
    ).toBe(false);
});
it("bounds line count and rejects case-insensitive duplicates", () => {
  expect(SuspendSaleSchema.safeParse({ ...input, lines: [] }).success).toBe(
    false,
  );
  expect(
    SuspendSaleSchema.safeParse({
      ...input,
      lines: [...input.lines, ...input.lines],
    }).success,
  ).toBe(false);
  expect(
    SuspendSaleSchema.safeParse({
      ...input,
      lines: Array.from({ length: 1001 }, () => input.lines[0]),
    }).success,
  ).toBe(false);
});
it("checkout association requires a UUID without coercion", () => {
  expect(CheckoutSchema.shape.suspendedSaleId.safeParse(id).success).toBe(true);
  expect(CheckoutSchema.shape.suspendedSaleId.safeParse(1).success).toBe(false);
});

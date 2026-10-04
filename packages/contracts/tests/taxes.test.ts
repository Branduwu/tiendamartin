import { it, expect } from "vitest";
import {
  TaxProfileInputSchema,
  TaxRateSchema,
  TaxSnapshotSchema,
  TaxExpectationsSchema,
} from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440101";
it("validates exact canonical basis points without coercion and technical bound", () => {
  for (const rate of ["0", "775", "1000000"])
    expect(TaxRateSchema.safeParse(rate).success).toBe(true);
  for (const rate of [
    "01",
    "-1",
    "1.5",
    "1e3",
    "1000001",
    100n,
    100,
    "9".repeat(10000),
  ])
    expect(TaxRateSchema.safeParse(rate).success).toBe(false);
});
it("keeps tax profiles strict and validates identity and name", () => {
  const v = { id, name: "Tax", rate: "775", active: true };
  expect(TaxProfileInputSchema.safeParse(v).success).toBe(true);
  expect(TaxProfileInputSchema.safeParse({ ...v, tenantId: id }).success).toBe(
    false,
  );
  expect(TaxProfileInputSchema.safeParse({ ...v, name: "" }).success).toBe(
    false,
  );
  expect(
    TaxExpectationsSchema.safeParse([
      { productId: id, profileId: id, rate: "0" },
      { productId: id.toUpperCase(), profileId: id, rate: "0" },
    ]).success,
  ).toBe(false);
});
it("rejects incorrect tax snapshots and malformed amounts without throwing", () => {
  const v = {
    profileId: id,
    name: "Tax",
    rate: "775",
    base: { currency: "MXN", minorUnits: "2000" },
    amount: { currency: "MXN", minorUnits: "155" },
  };
  expect(TaxSnapshotSchema.safeParse(v).success).toBe(true);
  expect(
    TaxSnapshotSchema.safeParse({
      ...v,
      amount: { currency: "MXN", minorUnits: "154" },
    }).success,
  ).toBe(false);
  expect(() =>
    TaxSnapshotSchema.safeParse({
      ...v,
      base: { currency: "MXN", minorUnits: "invalid" },
    }),
  ).not.toThrow();
});

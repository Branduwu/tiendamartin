import { expect, it } from "vitest";
import {
  InventoryAlertQuerySchema,
  SetInventoryMinimumSchema,
} from "../src/inventory-minimum";
const productId = "550e8400-e29b-41d4-a716-446655440002";
const locationId = "550e8400-e29b-41d4-a716-446655440003";

it("accepts exact nonnegative minimums whole pieces zero and explicit removal without defaults", () => {
  for (const minimumStock of [
    null,
    { unit: "kg", milliUnits: "9223372036854775807" },
    { unit: "piece", milliUnits: "1000" },
    { unit: "kg", milliUnits: "0" },
  ]) {
    const input = { productId, locationId, minimumStock };
    expect(SetInventoryMinimumSchema.parse(input)).toEqual(input);
  }
  expect(
    SetInventoryMinimumSchema.safeParse({ productId, locationId }).success,
  ).toBe(false);
});

it("strictly rejects forged authority malformed references fractional pieces and lossy quantities", () => {
  for (const minimumStock of [
    { unit: "kg", milliUnits: "-1" },
    { unit: "kg", milliUnits: "9223372036854775808" },
    { unit: "piece", milliUnits: "999" },
    { unit: "kg", milliUnits: "01" },
    { unit: "kg", milliUnits: 1000 },
    { unit: "kg", milliUnits: "1.0" },
    { unit: "kg", milliUnits: "1", role: "owner" },
  ])
    expect(
      SetInventoryMinimumSchema.safeParse({
        productId,
        locationId,
        minimumStock,
      }).success,
    ).toBe(false);
  for (const field of ["role", "userId", "tenantId"])
    expect(
      SetInventoryMinimumSchema.safeParse({
        productId,
        locationId,
        minimumStock: null,
        [field]: "forged",
      }).success,
    ).toBe(false);
  expect(InventoryAlertQuerySchema.parse({})).toEqual({});
  expect(InventoryAlertQuerySchema.parse({ productId, locationId })).toEqual({
    productId,
    locationId,
  });
  for (const input of [
    { productId: "bad" },
    { locationId: "bad" },
    { tenantId: productId },
    { role: "owner" },
  ])
    expect(InventoryAlertQuerySchema.safeParse(input).success).toBe(false);
});

import { expect, it, vi } from "vitest";
import { quantity } from "@smartretail/domain";
import {
  inventoryMinimum,
  PermissionDeniedError,
  setInventoryMinimum,
} from "../src/index";
const product = "550e8400-e29b-41d4-a716-446655440002";
const location = "550e8400-e29b-41d4-a716-446655440003";

it("delegates exact create update and disable preserving repository authorization failures", async () => {
  const setMinimum = vi.fn().mockResolvedValue(undefined);
  const input = { unit: "kg" as const, milliUnits: 1234n };
  const snapshot = inventoryMinimum(input);
  input.milliUnits = 9999n;
  expect(snapshot).toEqual(quantity("kg", 1234n));
  expect(Object.isFrozen(snapshot)).toBe(true);
  for (const minimum of [
    quantity("kg", 9007199254740993n),
    quantity("piece", 0n),
    null,
  ]) {
    await setInventoryMinimum({ setMinimum }, product, location, minimum);
    expect(setMinimum).toHaveBeenLastCalledWith(product, location, minimum);
  }
  setMinimum.mockRejectedValue(new PermissionDeniedError());
  await expect(
    setInventoryMinimum({ setMinimum }, product, location, null),
  ).rejects.toBeInstanceOf(PermissionDeniedError);
});

it("rejects invalid identifiers negative overflow and fractional piece values before repository access", () => {
  const setMinimum = vi.fn();
  for (const minimum of [
    quantity("kg", -1n),
    quantity("kg", 9223372036854775808n),
    quantity("piece", 1n),
  ])
    expect(() =>
      setInventoryMinimum({ setMinimum }, product, location, minimum),
    ).toThrow(RangeError);
  for (const [productId, locationId] of [
    ["bad", location],
    [product, "bad"],
  ])
    expect(() =>
      setInventoryMinimum({ setMinimum }, productId!, locationId!, null),
    ).toThrow();
  expect(setMinimum).not.toHaveBeenCalled();
});

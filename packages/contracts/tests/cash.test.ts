import { expect, it } from "vitest";
import {
  OpenCashShiftSchema,
  CashMovementInputSchema,
  CloseCashShiftSchema,
} from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440030",
  cash = (minorUnits: unknown) => ({ currency: "MXN", minorUnits });
it("opening zero is valid and identity/totals cannot be forged", () => {
  const input = { id, locationId: id, openingCash: cash("0") };
  expect(OpenCashShiftSchema.safeParse(input).success).toBe(true);
  expect(
    OpenCashShiftSchema.safeParse({
      ...input,
      openedBy: id,
      expectedCash: cash("0"),
    }).success,
  ).toBe(false);
});
it.each([100, 100n, "-1", "1.0", "01", "1e3"])(
  "opening rejects invalid monetary input %s",
  (v) =>
    expect(
      OpenCashShiftSchema.safeParse({
        id,
        locationId: id,
        openingCash: cash(v),
      }).success,
    ).toBe(false),
);
it("moves need positive cash and a reason; unsupported kinds/fields fail", () => {
  const m = {
    id,
    shiftId: id,
    type: "cash_in",
    amount: cash("1"),
    reason: "SMOKE",
  };
  expect(CashMovementInputSchema.safeParse(m).success).toBe(true);
  for (const x of [
    { ...m, amount: cash("0") },
    { ...m, reason: "" },
    { ...m, type: "card" },
    { ...m, createdBy: id },
  ])
    expect(CashMovementInputSchema.safeParse(x).success).toBe(false);
});
it("close accepts nonnegative counted but no client expected or difference", () => {
  expect(
    CloseCashShiftSchema.safeParse({ shiftId: id, countedCash: cash("0") })
      .success,
  ).toBe(true);
  expect(
    CloseCashShiftSchema.safeParse({
      shiftId: id,
      countedCash: cash("1"),
      difference: cash("0"),
    }).success,
  ).toBe(false);
});

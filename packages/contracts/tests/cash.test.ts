import { CashHistorySchema } from "../src/cash";
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

it("validates a bounded empty history and rejects unknown or unbounded output", () => {
  expect(CashHistorySchema.parse({ shifts: [], movements: [] })).toEqual({
    shifts: [],
    movements: [],
  });
  expect(
    CashHistorySchema.safeParse({
      shifts: [],
      movements: [],
      tenantId: "forged",
    }).success,
  ).toBe(false);
  expect(
    CashHistorySchema.safeParse({ shifts: Array(11).fill({}), movements: [] })
      .success,
  ).toBe(false);
  expect(
    CashHistorySchema.safeParse({ shifts: [], movements: Array(21).fill({}) })
      .success,
  ).toBe(false);
});

it("accepts ten/twenty valid records and rejects overflow with otherwise valid records", () => {
  const at = "2026-10-24T12:00:00.000Z",
    uuid = (n: number) =>
      `550e8400-e29b-41d4-a716-${n.toString().padStart(12, "0")}`;
  const shifts = Array.from({ length: 11 }, (_, n) => ({
    id: uuid(n),
    status: "closed",
    openedAt: at,
    closedAt: at,
    openingCash: { currency: "MXN", minorUnits: "100" },
    countedCash: { currency: "MXN", minorUnits: "50" },
    difference: { currency: "MXN", minorUnits: "-50" },
  }));
  const movements = Array.from({ length: 21 }, (_, n) => ({
    id: uuid(n),
    shiftId: uuid(0),
    type: "cash_in",
    amount: { currency: "MXN", minorUnits: "50" },
    reason: "Ingreso de prueba",
    createdBy: uuid(99),
    createdAt: at,
  }));
  expect(
    CashHistorySchema.safeParse({
      shifts: shifts.slice(0, 10),
      movements: movements.slice(0, 20),
    }).success,
  ).toBe(true);
  expect(
    CashHistorySchema.safeParse({ shifts, movements: movements.slice(0, 20) })
      .success,
  ).toBe(false);
  expect(
    CashHistorySchema.safeParse({ shifts: shifts.slice(0, 10), movements })
      .success,
  ).toBe(false);
});

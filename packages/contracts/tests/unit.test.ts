import { describe, expect, expectTypeOf, it } from "vitest";
import { UnitCodeSchema, type UnitCodeDto } from "../src/index";

describe("UnitCodeSchema", () => {
  it.each(["piece", "kg", "g", "l", "ml", "m", "cm"])(
    "accepts %s unchanged",
    (unit) => {
      expect(UnitCodeSchema.parse(unit)).toBe(unit);
    },
  );

  const invalid: readonly unknown[] = [
    "KG",
    "Piece",
    "unit",
    "box",
    "",
    " kg",
    "kg ",
    "kg\n",
    1,
    null,
    undefined,
    {},
    [],
    true,
  ];
  it.each(invalid.map((input) => ({ input })))(
    "rejects invalid unit $input",
    ({ input }) => {
      expect(UnitCodeSchema.safeParse(input).success).toBe(false);
    },
  );

  it("derives only the seven supported codes", () => {
    expectTypeOf<UnitCodeDto>().toEqualTypeOf<
      "piece" | "kg" | "g" | "l" | "ml" | "m" | "cm"
    >();
  });
});

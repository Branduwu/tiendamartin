import { describe, expect, expectTypeOf, it } from "vitest";
import {
  QuantitySchema,
  type QuantityDto,
  type UnitCodeDto,
} from "../src/index";

describe("QuantitySchema", () => {
  it.each([
    "0",
    "1",
    "1000",
    "1250",
    "-1",
    "-500",
    "9007199254740993123456789",
  ])(
    "accepts canonical milliUnits %s and round-trips as JSON",
    (milliUnits) => {
      const dto = QuantitySchema.parse({ unit: "kg", milliUnits });
      const decoded: unknown = JSON.parse(JSON.stringify(dto));
      expect(decoded).toStrictEqual({ unit: "kg", milliUnits });
      expect(QuantitySchema.parse(decoded)).toStrictEqual(dto);
    },
  );

  it("accepts fractional pieces at the contract boundary", () => {
    expect(
      QuantitySchema.parse({ unit: "piece", milliUnits: "500" }),
    ).toStrictEqual({ unit: "piece", milliUnits: "500" });
  });

  it("derives a serializable string-based DTO", () => {
    expectTypeOf<QuantityDto>().toEqualTypeOf<{
      unit: UnitCodeDto;
      milliUnits: string;
    }>();
  });

  const invalid: readonly unknown[] = [
    "01",
    "-01",
    "-0",
    "+1",
    "1.0",
    "1.250",
    "1e3",
    " 1",
    "1 ",
    "",
    "1\n",
    "1\r\n",
    "1\t",
    "１",
    "١",
    "0x10",
    "--1",
    1250,
    1.25,
    1250n,
    null,
    undefined,
    true,
    [],
    {},
  ];
  it.each(invalid.map((milliUnits) => ({ milliUnits })))(
    "rejects noncanonical or non-string milliUnits: $milliUnits",
    ({ milliUnits }) => {
      expect(QuantitySchema.safeParse({ unit: "kg", milliUnits }).success).toBe(
        false,
      );
    },
  );

  const invalidObjects: readonly unknown[] = [
    { unit: "KG", milliUnits: "1000" },
    { unit: "box", milliUnits: "1000" },
    { milliUnits: "1000" },
    { unit: "kg" },
    { unit: "kg", milliUnits: "1000", extra: true },
    { unit: "kg", milliUnits: "1000", extra: undefined },
    { unit: "kg", milliUnits: "1000", minorUnits: "1000" },
    { unit: "kg", minorUnits: "1000" },
    { unit: "kg", milliUnits: "1000", constructor: "unexpected" },
    null,
    [],
    "1000",
  ];
  it.each(invalidObjects.map((input) => ({ input })))(
    "rejects malformed objects and additional fields: $input",
    ({ input }) => {
      expect(QuantitySchema.safeParse(input).success).toBe(false);
    },
  );

  it("rejects a JSON __proto__ field without prototype pollution", () => {
    const input: unknown = JSON.parse(
      '{"unit":"kg","milliUnits":"1250","__proto__":{"polluted":true}}',
    );
    expect(QuantitySchema.safeParse(input).success).toBe(false);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it.each(["9".repeat(128), `-${"9".repeat(127)}`])(
    "accepts the 128-character technical boundary including sign",
    (milliUnits) => {
      expect(QuantitySchema.safeParse({ unit: "kg", milliUnits }).success).toBe(
        true,
      );
    },
  );

  it.each([
    "9".repeat(129),
    `-${"9".repeat(128)}`,
    "9".repeat(1_000_000),
    "x".repeat(1_000_000),
  ])("aborts long input before canonical validation", (milliUnits) => {
    const result = QuantitySchema.safeParse({ unit: "kg", milliUnits });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.message).toBe(
        "milliUnits must not exceed 128 characters",
      );
    }
  });
});

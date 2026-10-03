import { describe, expect, expectTypeOf, it } from "vitest";
import { MoneySchema, type MoneyDto } from "../src/index";

describe("MoneySchema", () => {
  it.each(["0", "1", "100", "-1", "-500", "9007199254740993123456789"])(
    "accepts canonical integer %s and round-trips through JSON",
    (minorUnits) => {
      const dto = MoneySchema.parse({ currency: "MXN", minorUnits });
      const decoded: unknown = JSON.parse(JSON.stringify(dto));
      expect(decoded).toStrictEqual({ currency: "MXN", minorUnits });
      expect(MoneySchema.parse(decoded)).toStrictEqual(dto);
    },
  );

  it("derives a string-based DTO", () => {
    expectTypeOf<MoneyDto>().toEqualTypeOf<{
      currency: "MXN";
      minorUnits: string;
    }>();
  });

  const invalidMinorUnits: readonly unknown[] = [
    "01",
    "-01",
    "-0",
    "+1",
    "1.0",
    "1.25",
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
    100,
    1.25,
    100n,
    null,
    undefined,
    true,
    [],
    {},
  ];
  it.each(invalidMinorUnits.map((minorUnits) => ({ minorUnits })))(
    "rejects noncanonical or non-string minorUnits: $minorUnits",
    ({ minorUnits }) => {
      expect(
        MoneySchema.safeParse({ currency: "MXN", minorUnits }).success,
      ).toBe(false);
    },
  );

  const invalidObjects: readonly unknown[] = [
    { currency: "USD", minorUnits: "1" },
    { currency: "mxn", minorUnits: "1" },
    { minorUnits: "1" },
    { currency: "MXN" },
    { currency: "MXN", minorUnits: "1", extra: true },
    { currency: "MXN", minorUnits: "1", extra: undefined },
    { currency: "MXN", minorUnits: "1", constructor: "unexpected" },
    null,
    [],
    "1",
  ];
  it.each(invalidObjects.map((input) => ({ input })))(
    "rejects invalid or extra object fields: $input",
    ({ input }) => {
      expect(MoneySchema.safeParse(input).success).toBe(false);
    },
  );

  it("rejects a JSON __proto__ key without changing prototypes", () => {
    const input: unknown = JSON.parse(
      '{"currency":"MXN","minorUnits":"1","__proto__":{"polluted":true}}',
    );
    expect(MoneySchema.safeParse(input).success).toBe(false);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it.each(["9".repeat(128), `-${"9".repeat(127)}`])(
    "accepts the technical boundary including the sign",
    (minorUnits) => {
      expect(
        MoneySchema.safeParse({ currency: "MXN", minorUnits }).success,
      ).toBe(true);
    },
  );

  it.each([
    "9".repeat(129),
    `-${"9".repeat(128)}`,
    "9".repeat(1_000_000),
    "x".repeat(1_000_000),
  ])(
    "rejects inputs exceeding the technical limit before canonical validation",
    (minorUnits) => {
      const result = MoneySchema.safeParse({ currency: "MXN", minorUnits });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0]?.message).toBe(
          "minorUnits must not exceed 128 characters",
        );
      }
    },
  );
});

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ProductSchema,
  ProductIdSchema,
  ProductNameSchema,
  SkuSchema,
  BarcodeSchema,
  ProductStatusSchema,
  MoneySchema,
  type ProductDto,
} from "../src/index";

const id = "550e8400-e29b-41d4-a716-446655440000";
const base = () => ({
  id,
  name: "Café soluble",
  sku: "CAFE-001",
  unit: "piece",
  purchaseCost: { currency: "MXN", minorUnits: "7500" },
  salePrice: { currency: "MXN", minorUnits: "10000" },
  status: "active",
});

describe("Product field contracts", () => {
  const cases = [
    {
      schema: ProductIdSchema,
      valid: [
        id,
        id.toUpperCase(),
        "01890f3e-7bca-7cc1-98c4-dc0c0c07398f",
        "00000000-0000-0000-0000-000000000000",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
      ],
      invalid: [
        "",
        "bad",
        id.slice(0, -1),
        ` ${id}`,
        `${id}\n`,
        id.replace("a716", "0716"),
        id.replace("41d4", "91d4"),
      ],
    },
    {
      schema: ProductNameSchema,
      valid: [
        "A",
        "Café soluble",
        "Leche deslactosada 1 L",
        'Tornillo ¼"',
        "A  B",
        "Cafe\u0301",
        "🧑‍🍼",
        "商品",
        "A".repeat(120),
        "😀".repeat(120),
      ],
      invalid: [
        "",
        " ",
        "\u00a0",
        " A",
        "A ",
        "A\tB",
        "A\rB",
        "A\nB",
        "A\0B",
        "A\u007fB",
        "A\u0085B",
        "A\u200bB",
        "A\u202eB",
        "A\u2028B",
        "\u200d",
        "\ud800",
        "A".repeat(121),
        "😀".repeat(121),
      ],
    },
    {
      schema: SkuSchema,
      valid: [
        "A",
        "0",
        "ABC123",
        "COCA-600",
        "TORNILLO_001",
        "A.100-B",
        "A..__--B",
        "A".repeat(64),
      ],
      invalid: [
        "",
        "abc123",
        " ABC123",
        "ABC123 ",
        "ABC 123",
        "-ABC",
        "ABC-",
        ".A",
        "A_",
        "ÁBC123",
        "АBC123",
        "ＡBC123",
        "A😀",
        "A\0B",
        "A\n",
        "A\tB",
        "A\u200bB",
        "A".repeat(65),
      ],
    },
    {
      schema: BarcodeSchema,
      valid: [
        "!",
        "~",
        "7501234567890",
        "012345678905",
        "ABC-001-XYZ",
        "12345678901234567890",
        "constructor",
        "__proto__",
        "A".repeat(128),
      ],
      invalid: [
        "",
        " ",
        " A",
        "A ",
        "A B",
        "A\t",
        "A\r",
        "A\n",
        "A\0",
        "A\u007f",
        "é",
        "Ａ",
        "😀",
        "A\u200b",
        "A".repeat(129),
      ],
    },
    {
      schema: ProductStatusSchema,
      valid: ["active", "inactive"],
      invalid: ["", "Active", "deleted", "archived", "discontinued"],
    },
  ];
  for (const { schema, valid, invalid } of cases) {
    it.each(valid)("preserves valid field string", (value) =>
      expect(schema.parse(value)).toBe(value),
    );
    it.each(invalid)("rejects invalid field string", (value) =>
      expect(schema.safeParse(value).success).toBe(false),
    );
    const wrong: readonly unknown[] = [
      null,
      undefined,
      100,
      100n,
      true,
      [],
      {},
      new String("A"),
      {
        toString() {
          throw new Error("Must not coerce");
        },
      },
    ];
    it.each(wrong.map((value) => ({ value })))(
      "rejects nonstring field without coercion",
      ({ value }) => expect(schema.safeParse(value).success).toBe(false),
    );
    it("rejects enormous fields", () =>
      expect(schema.safeParse("A".repeat(1_000_000)).success).toBe(false));
  }
});

describe("ProductSchema", () => {
  it("round-trips a full serializable product", () => {
    const value = { ...base(), barcode: "7501234567890" };
    const dto = ProductSchema.parse(value);
    expect(dto).toStrictEqual(value);
    const decoded: unknown = JSON.parse(JSON.stringify(dto));
    expect(ProductSchema.parse(decoded)).toStrictEqual(dto);
  });
  it("preserves absence of barcode", () =>
    expect(Object.hasOwn(ProductSchema.parse(base()), "barcode")).toBe(false));
  it.each(["piece", "kg", "g", "l", "ml", "m", "cm"])(
    "accepts unit %s",
    (unit) => expect(ProductSchema.parse({ ...base(), unit }).unit).toBe(unit),
  );
  it.each(["active", "inactive"])("accepts status %s", (status) =>
    expect(ProductSchema.parse({ ...base(), status }).status).toBe(status),
  );
  it.each([
    ["0", "0"],
    ["100", "0"],
    ["100", "50"],
    ["9".repeat(128), "9007199254740993123456789"],
  ])("permits zero, loss and huge canonical prices", (cost, sale) => {
    const result = ProductSchema.parse({
      ...base(),
      purchaseCost: { currency: "MXN", minorUnits: cost },
      salePrice: { currency: "MXN", minorUnits: sale },
    });
    expect(result.purchaseCost.minorUnits).toBe(cost);
    expect(result.salePrice.minorUnits).toBe(sale);
  });
  const invalid: readonly (readonly [string, unknown])[] = [
    ["id", "bad"],
    ["name", ""],
    ["sku", "lowercase"],
    ["unit", "KG"],
    ["status", "deleted"],
    ["barcode", undefined],
    ["barcode", null],
    ["barcode", ""],
    ["barcode", " "],
    ["barcode", 100],
    ["barcode", 100n],
    ["purchaseCost", { currency: "MXN", minorUnits: "-1" }],
    ["salePrice", { currency: "MXN", minorUnits: "-1" }],
    ["salePrice", 100],
    ["salePrice", 100n],
    ["salePrice", null],
    ["salePrice", []],
    ["salePrice", { currency: "USD", minorUnits: "100" }],
    ["salePrice", { currency: "MXN", minorUnits: 100 }],
    ["salePrice", { currency: "MXN", minorUnits: 100n }],
    ["salePrice", { currency: "MXN", minorUnits: "01" }],
    ["salePrice", { currency: "MXN", minorUnits: "-0" }],
    ["salePrice", { currency: "MXN", minorUnits: "1.5" }],
    ["salePrice", { currency: "MXN", minorUnits: "9".repeat(129) }],
    ["purchaseCost", { currency: "MXN", minorUnits: "9".repeat(1_000_000) }],
  ];
  it.each(invalid)("rejects malformed contextual field %s", (field, value) =>
    expect(ProductSchema.safeParse({ ...base(), [field]: value }).success).toBe(
      false,
    ),
  );
  it.each([
    "extra",
    "constructor",
    "__proto__",
    "stock",
    "available",
    "reserved",
    "quantity",
    "inventory",
    "warehouse",
    "locationId",
    "tenantId",
    "storeId",
  ])("rejects additional key %s at Product and Money levels", (key) => {
    const input: unknown = JSON.parse(
      JSON.stringify({ ...base(), [key]: true }),
    );
    expect(ProductSchema.safeParse(input).success).toBe(false);
    for (const field of ["purchaseCost", "salePrice"]) {
      expect(
        ProductSchema.safeParse({
          ...base(),
          [field]: JSON.parse(
            JSON.stringify({ currency: "MXN", minorUnits: "100", [key]: true }),
          ),
        }).success,
      ).toBe(false);
    }
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
  it.each(
    [null, undefined, [], 100, 100n, "product"].map((value) => ({ value })),
  )("rejects unexpected root values", ({ value }) =>
    expect(ProductSchema.safeParse(value).success).toBe(false),
  );
  it.each(["id", "name", "sku", "unit", "purchaseCost", "salePrice", "status"])(
    "requires %s",
    (key) => {
      const input = base();
      Reflect.deleteProperty(input, key);
      expect(ProductSchema.safeParse(input).success).toBe(false);
    },
  );
  it("preserves globally signed Money", () =>
    expect(
      MoneySchema.parse({ currency: "MXN", minorUnits: "-1" }).minorUnits,
    ).toBe("-1"));
  it("accepts string Money where a number fails", () =>
    expect(
      ProductSchema.safeParse({
        ...base(),
        salePrice: { currency: "MXN", minorUnits: "100" },
      }).success,
    ).toBe(true));
  it("derives exact optional DTO fields", () => {
    expectTypeOf<
      ProductDto["salePrice"]["minorUnits"]
    >().toEqualTypeOf<string>();
    expectTypeOf<{ barcode: undefined }>().not.toExtend<
      Pick<ProductDto, "barcode">
    >();
    expectTypeOf<ProductDto["status"]>().toEqualTypeOf<"active" | "inactive">();
  });
});

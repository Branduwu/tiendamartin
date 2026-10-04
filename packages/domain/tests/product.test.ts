import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createProduct,
  productId,
  productName,
  sku,
  barcode,
  money,
  addMoney,
  InvalidProductFieldError,
  type Product,
  type ProductId,
  type ProductName,
  type Sku,
  type Barcode,
  type CreateProductInput,
} from "../src/index";

const id = "550e8400-e29b-41d4-a716-446655440000";
const base = (): CreateProductInput => ({
  id: productId(id),
  name: productName("Café soluble"),
  sku: sku("CAFE-001"),
  unit: "piece",
  purchaseCost: money(7500n),
  salePrice: money(10000n),
  status: "active",
});

describe("Product fields", () => {
  it.each([
    id,
    id.toUpperCase(),
    "01890f3e-7bca-7cc1-98c4-dc0c0c07398f",
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
  ])("preserves valid UUID %s", (value) =>
    expect(productId(value)).toBe(value),
  );
  it.each([
    "",
    "arbitrary",
    id.slice(0, -1),
    ` ${id}`,
    `${id}\n`,
    id.replace("a716", "0716"),
    id.replace("41d4", "91d4"),
  ])("rejects invalid UUID %s", (value) =>
    expect(() => productId(value)).toThrow(InvalidProductFieldError),
  );
  it.each([
    "A",
    "Café soluble",
    "Leche deslactosada 1 L",
    'Tornillo ¼"',
    "A  B",
    "Cafe\u0301",
    "🧑‍🍼",
    "商品",
    "😀".repeat(120),
    "A".repeat(120),
  ])("preserves Unicode name", (value) =>
    expect(productName(value)).toBe(value),
  );
  it.each([
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
  ])("rejects invalid name", (value) =>
    expect(() => productName(value)).toThrow(InvalidProductFieldError),
  );
  it.each([
    "A",
    "0",
    "ABC123",
    "COCA-600",
    "TORNILLO_001",
    "A.100-B",
    "A..__--B",
    "A".repeat(64),
  ])("preserves SKU %s", (value) => expect(sku(value)).toBe(value));
  it.each([
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
  ])("rejects noncanonical SKU", (value) =>
    expect(() => sku(value)).toThrow(InvalidProductFieldError),
  );
  it.each([
    "!",
    "~",
    "7501234567890",
    "012345678905",
    "ABC-001-XYZ",
    "12345678901234567890",
    "constructor",
    "__proto__",
    "A".repeat(128),
  ])("preserves visible ASCII barcode", (value) =>
    expect(barcode(value)).toBe(value),
  );
  it.each([
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
  ])("rejects invalid barcode", (value) =>
    expect(() => barcode(value)).toThrow(InvalidProductFieldError),
  );
  const wrongTypes: readonly unknown[] = [
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
  it.each(wrongTypes.map((value) => ({ value })))(
    "rejects unexpected types without coercion: $value",
    ({ value }) => {
      for (const factory of [productId, productName, sku, barcode])
        expect(() => Reflect.apply(factory, undefined, [value])).toThrow(
          InvalidProductFieldError,
        );
    },
  );
  it("brands validated fields and exposes exact optional readonly Product", () => {
    expectTypeOf<string>().not.toExtend<ProductId>();
    expectTypeOf<ProductId>().not.toExtend<Sku>();
    expectTypeOf<ProductName>().not.toExtend<Barcode>();
    expectTypeOf<Product>().toEqualTypeOf<
      Readonly<{
        id: ProductId;
        name: ProductName;
        sku: Sku;
        barcode?: Barcode;
        taxProfileId?: string;
        unit: "piece" | "kg" | "g" | "l" | "ml" | "m" | "cm";
        purchaseCost: ReturnType<typeof money>;
        salePrice: ReturnType<typeof money>;
        status: "active" | "inactive";
      }>
    >();
    expectTypeOf<{ barcode: undefined }>().not.toExtend<
      Pick<Product, "barcode">
    >();
  });
});

describe("Product creation", () => {
  it("creates a complete Product", () => {
    const input = { ...base(), barcode: barcode("7501234567890") };
    expect(createProduct(input)).toStrictEqual(input);
  });
  it("omits barcode when absent and adds no inventory or tenancy fields", () => {
    expect(Object.keys(createProduct(base())).sort()).toEqual(
      [
        "id",
        "name",
        "sku",
        "unit",
        "purchaseCost",
        "salePrice",
        "status",
      ].sort(),
    );
  });
  it.each(["piece", "kg", "g", "l", "ml", "m", "cm"] as const)(
    "accepts unit %s",
    (unit) => expect(createProduct({ ...base(), unit }).unit).toBe(unit),
  );
  it.each(["active", "inactive"] as const)("accepts status %s", (status) =>
    expect(createProduct({ ...base(), status }).status).toBe(status),
  );
  it.each([
    [0n, 0n],
    [100n, 0n],
    [100n, 50n],
    [9007199254740993123456789n, 9007199254740993123456788n],
  ] as const)("allows zero, loss and exact large prices", (cost, sale) => {
    const result = createProduct({
      ...base(),
      purchaseCost: money(cost),
      salePrice: money(sale),
    });
    expect(result.purchaseCost.minorUnits).toBe(cost);
    expect(result.salePrice.minorUnits).toBe(sale);
  });
  const invalidFields: readonly (readonly [string, unknown])[] = [
    ["id", "bad"],
    ["name", ""],
    ["sku", "lowercase"],
    ["barcode", null],
    ["barcode", undefined],
    ["barcode", ""],
    ["barcode", 100],
    ["unit", "KG"],
    ["status", "deleted"],
    ["purchaseCost", money(-1n)],
    ["salePrice", money(-1n)],
    ["salePrice", 100],
    ["salePrice", null],
    ["salePrice", { currency: "USD", minorUnits: 1n }],
    ["purchaseCost", { currency: "MXN", minorUnits: 1 }],
    ["salePrice", { currency: "MXN", minorUnits: "1" }],
  ];
  it.each(invalidFields)(
    "revalidates %s for direct JavaScript callers",
    (field, value) => {
      expect(() =>
        Reflect.apply(createProduct, undefined, [
          { ...base(), [field]: value },
        ]),
      ).toThrow(TypeError);
    },
  );
  it.each([null, undefined, [], 100].map((value) => ({ value })))(
    "rejects nonobject creation input",
    ({ value }) =>
      expect(() => Reflect.apply(createProduct, undefined, [value])).toThrow(
        TypeError,
      ),
  );
  it("protects nested prices from later changes to a mutable input", () => {
    const mutablePrice = { currency: "MXN" as const, minorUnits: 100n };
    const input = {
      ...base(),
      purchaseCost: mutablePrice,
      salePrice: mutablePrice,
    };
    const result = createProduct(input);
    mutablePrice.minorUnits = -100n;
    input.name = productName("Changed");
    expect(result.name).toBe("Café soluble");
    expect(result.purchaseCost.minorUnits).toBe(100n);
    expect(result.salePrice.minorUnits).toBe(100n);
    expect(Reflect.set(result, "status", "inactive")).toBe(false);
    expect(Reflect.deleteProperty(result, "sku")).toBe(false);
    for (const price of [result.purchaseCost, result.salePrice])
      expect(Reflect.set(price, "minorUnits", -1n)).toBe(false);
    expect(addMoney(result.salePrice, money(1n)).minorUnits).toBe(101n);
    expect(result.salePrice.minorUnits).toBe(100n);
  });
  it("does not pretend to enforce uniqueness or disclose rejected values", () => {
    expect(createProduct(base())).toEqual(createProduct(base()));
    expect(() => sku("private invalid value")).toThrow("Invalid Product sku");
  });
});

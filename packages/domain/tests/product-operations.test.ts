import { describe, expect, it } from "vitest";
import {
  createProduct,
  productId,
  productName,
  sku,
  barcode,
  money,
  renameProduct,
  changeProductSku,
  changeProductBarcode,
  removeProductBarcode,
  changeProductUnit,
  changePurchaseCost,
  changeSalePrice,
  activateProduct,
  deactivateProduct,
  type Product,
} from "../src/index";

const base = () =>
  createProduct({
    id: productId("550e8400-e29b-41d4-a716-446655440000"),
    name: productName("Café"),
    sku: sku("CAFE-001"),
    barcode: barcode("012345678905"),
    unit: "piece",
    purchaseCost: money(100n),
    salePrice: money(150n),
    status: "active",
  });
const commands = [
  {
    name: "rename",
    field: "name",
    value: productName("Nuevo café"),
    run: (p: Product) => renameProduct(p, "Nuevo café"),
  },
  {
    name: "sku",
    field: "sku",
    value: sku("CAFE-002"),
    run: (p: Product) => changeProductSku(p, "CAFE-002"),
  },
  {
    name: "barcode",
    field: "barcode",
    value: barcode("ABC-123"),
    run: (p: Product) => changeProductBarcode(p, "ABC-123"),
  },
  { name: "remove", field: "barcode", run: removeProductBarcode },
  {
    name: "unit",
    field: "unit",
    value: "kg",
    run: (p: Product) => changeProductUnit(p, "kg"),
  },
  {
    name: "cost",
    field: "purchaseCost",
    value: money(200n),
    run: (p: Product) => changePurchaseCost(p, money(200n)),
  },
  {
    name: "price",
    field: "salePrice",
    value: money(50n),
    run: (p: Product) => changeSalePrice(p, money(50n)),
  },
  { name: "activate", field: "status", value: "active", run: activateProduct },
  {
    name: "deactivate",
    field: "status",
    value: "inactive",
    run: deactivateProduct,
  },
] as const;

describe("Product operations", () => {
  it.each(commands)(
    "$name preserves identity and every unrelated field",
    (command) => {
      const original = base();
      const before = { ...original };
      const result = command.run(original);
      const expected = { ...original };
      if (command.name === "remove")
        Reflect.deleteProperty(expected, "barcode");
      else Reflect.set(expected, command.field, command.value);
      expect(result).toStrictEqual(expected);
      expect(result.id).toBe(original.id);
      expect(result).not.toBe(original);
      expect(original).toStrictEqual(before);
      for (const value of [result, result.purchaseCost, result.salePrice]) {
        expect(Object.isFrozen(value)).toBe(true);
        expect(Reflect.set(value, "unexpected", true)).toBe(false);
      }
      expect(
        Reflect.set(
          result,
          "id",
          productId("01890f3e-7bca-7cc1-98c4-dc0c0c07398f"),
        ),
      ).toBe(false);
      expect(Reflect.set(result.salePrice, "minorUnits", -1n)).toBe(false);
    },
  );
  it.each([
    "A",
    "A".repeat(120),
    "😀".repeat(120),
    "Nuevo café 🧑‍🍼",
    "Cafe\u0301",
  ])("renames with unchanged Unicode value", (name) =>
    expect(renameProduct(base(), name).name).toBe(name),
  );
  it.each([
    "",
    "A".repeat(121),
    "😀".repeat(121),
    " A",
    "A ",
    "A\n",
    "A\tB",
    "A\0B",
    "A\u200bB",
  ])("rejects invalid name", (name) =>
    expect(() => renameProduct(base(), name)).toThrow(TypeError),
  );
  it.each(["A", "A".repeat(64), "A.100-B"])("changes canonical SKU", (value) =>
    expect(changeProductSku(base(), value).sku).toBe(value),
  );
  it.each([
    "",
    "A".repeat(65),
    "lowercase",
    " A",
    "A ",
    "A B",
    "ÁBC",
    "АBC",
    "ＡBC",
    "-ABC",
    "ABC_",
    "A\u200bB",
    "A\n",
  ])("rejects invalid SKU", (value) =>
    expect(() => changeProductSku(base(), value)).toThrow(TypeError),
  );
  it.each(["!", "A".repeat(128), "constructor", "__proto__"])(
    "adds or replaces barcode",
    (value) => {
      expect(changeProductBarcode(base(), value).barcode).toBe(value);
      const absent = removeProductBarcode(base());
      expect(changeProductBarcode(absent, value).barcode).toBe(value);
      expect(Object.hasOwn(absent, "barcode")).toBe(false);
    },
  );
  it.each([
    "",
    " ",
    "A B",
    "A".repeat(129),
    "A\n",
    "A\r",
    "A\t",
    "A\0",
    "A\u200b",
    "é",
  ])("rejects invalid barcode", (value) =>
    expect(() => changeProductBarcode(base(), value)).toThrow(TypeError),
  );
  it("removes barcode with exact absence and value-idempotent fresh results", () => {
    const original = base();
    const removed = removeProductBarcode(original);
    const twice = removeProductBarcode(removed);
    expect(Object.hasOwn(removed, "barcode")).toBe(false);
    expect(Object.hasOwn(twice, "barcode")).toBe(false);
    expect(twice).toStrictEqual(removed);
    expect(twice).not.toBe(removed);
    expect(original.barcode).toBe("012345678905");
  });
  const units = ["piece", "kg", "g", "l", "ml", "m", "cm"] as const;
  it.each(units.flatMap((from) => units.map((to) => ({ from, to }))))(
    "changes $from to $to without converting anything",
    ({ from, to }) => {
      const original = createProduct({ ...base(), unit: from });
      const result = changeProductUnit(original, to);
      expect(result).toStrictEqual({ ...original, unit: to });
      expect(original.unit).toBe(from);
    },
  );
  it.each([0n, 50n, 100n, 200n, 9007199254740993123456789n])(
    "updates exact nonnegative prices independently",
    (amount) => {
      const original = base();
      expect(changePurchaseCost(original, money(amount))).toStrictEqual({
        ...original,
        purchaseCost: money(amount),
      });
      expect(changeSalePrice(original, money(amount))).toStrictEqual({
        ...original,
        salePrice: money(amount),
      });
      expect(original).toStrictEqual(base());
    },
  );
  it.each(["active", "inactive"] as const)(
    "activates/deactivates %s with fresh value-idempotent results",
    (status) => {
      const original = createProduct({ ...base(), status });
      for (const [operation, expected] of [
        [activateProduct, "active"],
        [deactivateProduct, "inactive"],
      ] as const) {
        const once = operation(original);
        const twice = operation(once);
        expect(once).toStrictEqual({ ...original, status: expected });
        expect(twice).toStrictEqual(once);
        expect(once).not.toBe(original);
        expect(twice).not.toBe(once);
        expect(original.status).toBe(status);
      }
    },
  );
  it.each(commands)(
    "$name accepts valid mutable inputs but never returns them",
    ({ run }) => {
      const mutable = {
        ...base(),
        purchaseCost: { currency: "MXN" as const, minorUnits: 100n },
        salePrice: { currency: "MXN" as const, minorUnits: 150n },
      };
      const result = run(mutable);
      const before = { ...result };
      mutable.name = productName("Changed");
      mutable.purchaseCost.minorUnits = -1n;
      mutable.salePrice.minorUnits = -1n;
      expect(result).not.toBe(mutable);
      expect(result).toStrictEqual(before);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.salePrice)).toBe(true);
    },
  );
});

describe("Runtime rejection", () => {
  const bad: readonly unknown[] = [
    null,
    undefined,
    100,
    100n,
    {},
    [],
    true,
    {
      toString() {
        throw Error("No coercion");
      },
    },
  ];
  it.each(bad.map((value) => ({ value })))(
    "rejects malformed new string/unit inputs",
    ({ value }) => {
      for (const operation of [
        renameProduct,
        changeProductSku,
        changeProductBarcode,
        changeProductUnit,
      ])
        expect(() =>
          Reflect.apply(operation, undefined, [base(), value]),
        ).toThrow(TypeError);
    },
  );
  it.each(["KG", "box", " kg", "piece\n"])("rejects forged UnitCode", (unit) =>
    expect(() =>
      Reflect.apply(changeProductUnit, undefined, [base(), unit]),
    ).toThrow(TypeError),
  );
  const badPrices: readonly unknown[] = [
    ...bad,
    money(-1n),
    { currency: "USD", minorUnits: 1n },
    { currency: "MXN", minorUnits: 100 },
    { currency: "MXN", minorUnits: "100" },
  ];
  it.each(badPrices.map((value) => ({ value })))(
    "rejects malformed or negative Money",
    ({ value }) => {
      const original = base();
      for (const operation of [changePurchaseCost, changeSalePrice])
        expect(() =>
          Reflect.apply(operation, undefined, [original, value]),
        ).toThrow(TypeError);
      expect(original).toStrictEqual(base());
    },
  );
  const invalidProducts: readonly unknown[] = [
    ...bad,
    ...[
      ["id", "bad"],
      ["name", ""],
      ["sku", "lower"],
      ["barcode", undefined],
      ["barcode", null],
      ["unit", "box"],
      ["purchaseCost", money(-1n)],
      ["salePrice", money(-1n)],
      ["status", "deleted"],
    ].map(([field, value]) => ({ ...base(), [String(field)]: value })),
    { id: base().id },
  ];
  it.each(invalidProducts.map((value) => ({ value })))(
    "revalidates the whole original, including the replaced field",
    ({ value }) => {
      for (const { run } of commands)
        expect(() => Reflect.apply(run, undefined, [value])).toThrow(TypeError);
    },
  );
});

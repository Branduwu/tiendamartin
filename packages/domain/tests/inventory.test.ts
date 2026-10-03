import { describe, expect, expectTypeOf, it } from "vitest";
import * as domain from "../src/index";
import {
  inventoryLocationId,
  inventoryLocationCode,
  inventoryLocationName,
  createInventoryLocation,
  stockBalance,
  productId,
  quantity,
  type InventoryLocation,
  type InventoryLocationId,
  type ProductId,
  type StockBalance,
} from "../src/index";

const pid = "550e8400-e29b-41d4-a716-446655440000";
const lid = "550e8400-e29b-41d4-a716-446655440001";
const location = (): InventoryLocation => ({
  id: inventoryLocationId(lid),
  code: inventoryLocationCode("MAIN"),
  name: inventoryLocationName("Piso de venta"),
  status: "active",
});
const balance = (): StockBalance => ({
  productId: productId(pid),
  locationId: inventoryLocationId(lid),
  quantity: quantity("piece", 5000n),
});

describe("InventoryLocation", () => {
  it.each([
    lid,
    lid.toUpperCase(),
    "01890f3e-7bca-7cc1-98c4-dc0c0c07398f",
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
  ])("preserves valid UUID", (value) =>
    expect(inventoryLocationId(value)).toBe(value),
  );
  it.each([
    "",
    "invalid",
    lid.slice(0, -1),
    ` ${lid}`,
    `${lid}\n`,
    lid.replace("a716", "0716"),
  ])("rejects invalid UUID", (value) =>
    expect(() => inventoryLocationId(value)).toThrow(TypeError),
  );
  it.each([
    "A",
    "0",
    "MAIN",
    "STORE-01",
    "WAREHOUSE_1",
    "BODEGA-A",
    "A__--B",
    "A".repeat(32),
  ])("preserves canonical code", (value) =>
    expect(inventoryLocationCode(value)).toBe(value),
  );
  it.each([
    "",
    "main",
    " STORE",
    "STORE ",
    "-STORE",
    "STORE-",
    "_STORE",
    "STORE_",
    "BODÉGA",
    "STОRE",
    "ＳTORE",
    "STORE 01",
    "STORE.01",
    "A\0B",
    "A\rB",
    "A\n",
    "A\tB",
    "A\u200bB",
    "😀",
    "A".repeat(33),
  ])("rejects invalid code", (value) =>
    expect(() => inventoryLocationCode(value)).toThrow(TypeError),
  );
  it.each([
    "A",
    "Almacén principal",
    "Bodega Norte",
    "A  B",
    "Cafe\u0301",
    "🧑‍🍼",
    "商品",
    "A".repeat(100),
    "😀".repeat(100),
  ])("preserves Unicode name", (value) =>
    expect(inventoryLocationName(value)).toBe(value),
  );
  it.each([
    "",
    " ",
    " A",
    "A ",
    "\u00a0",
    "A\0B",
    "A\n",
    "A\rB",
    "A\tB",
    "A\u007fB",
    "A\u0085B",
    "A\u200bB",
    "A\u202eB",
    "\u200d",
    "\ud800",
    "A".repeat(101),
    "😀".repeat(101),
  ])("rejects invalid name", (value) =>
    expect(() => inventoryLocationName(value)).toThrow(TypeError),
  );
  it.each(["active", "inactive"] as const)(
    "creates immutable %s location without extra fields",
    (status) => {
      const input = { ...location(), status };
      const result = createInventoryLocation(input);
      expect(result).toStrictEqual(input);
      expect(result).not.toBe(input);
      expect(Object.keys(result).sort()).toEqual([
        "code",
        "id",
        "name",
        "status",
      ]);
      input.name = inventoryLocationName("Changed");
      expect(result.name).toBe("Piso de venta");
      expect(Reflect.set(result, "status", "inactive")).toBe(false);
      expect(Reflect.deleteProperty(result, "code")).toBe(false);
    },
  );
  it.each(
    ["deleted", "archived", "Active", undefined, null, 100].map((status) => ({
      status,
    })),
  )("rejects forged status", ({ status }) =>
    expect(() =>
      Reflect.apply(createInventoryLocation, undefined, [
        { ...location(), status },
      ]),
    ).toThrow(TypeError),
  );
  it.each(["id", "code", "name", "status"])(
    "requires and revalidates %s",
    (field) => {
      const input = { ...location() };
      Reflect.deleteProperty(input, field);
      expect(() =>
        Reflect.apply(createInventoryLocation, undefined, [input]),
      ).toThrow(TypeError);
      expect(() =>
        Reflect.apply(createInventoryLocation, undefined, [
          { ...location(), [field]: field === "name" ? "" : "invalid" },
        ]),
      ).toThrow(TypeError);
    },
  );
  it("keeps distinct nominal identity and does not enforce uniqueness", () => {
    expectTypeOf<ProductId>().not.toExtend<InventoryLocationId>();
    expectTypeOf<InventoryLocationId>().not.toExtend<ProductId>();
    expectTypeOf<string>().not.toExtend<InventoryLocationId>();
    expectTypeOf<InventoryLocation>().toEqualTypeOf<
      Readonly<InventoryLocation>
    >();
    expect(createInventoryLocation(location())).toStrictEqual(
      createInventoryLocation(location()),
    );
  });
});

describe("StockBalance", () => {
  it.each([5000n, 1250n, 0n, -500n, 9007199254740993123456789n])(
    "represents signed exact quantity without operations",
    (milliUnits) => {
      const result = stockBalance({
        ...balance(),
        quantity: quantity("kg", milliUnits),
      });
      expect(result).toStrictEqual({
        productId: pid,
        locationId: lid,
        quantity: { unit: "kg", milliUnits },
      });
    },
  );
  it.each(["piece", "kg", "g", "l", "ml", "m", "cm"] as const)(
    "preserves %s without a Product unit check",
    (unit) =>
      expect(
        stockBalance({ ...balance(), quantity: quantity(unit, 1n) }).quantity,
      ).toStrictEqual(quantity(unit, 1n)),
  );
  it.each(["productId", "locationId"])("revalidates %s", (field) =>
    expect(() =>
      Reflect.apply(stockBalance, undefined, [
        { ...balance(), [field]: "invalid" },
      ]),
    ).toThrow(TypeError),
  );
  it.each(
    [
      null,
      undefined,
      100,
      100n,
      "100",
      [],
      {},
      { unit: "KG", milliUnits: 100n },
      { unit: "kg", milliUnits: 100 },
      { unit: "kg", milliUnits: "100" },
    ].map((value) => ({ value })),
  )("rejects forged Quantity", ({ value }) =>
    expect(() =>
      Reflect.apply(stockBalance, undefined, [
        { ...balance(), quantity: value },
      ]),
    ).toThrow(TypeError),
  );
  it.each(["productId", "locationId", "quantity"])("requires %s", (field) => {
    const input = { ...balance() };
    Reflect.deleteProperty(input, field);
    expect(() => Reflect.apply(stockBalance, undefined, [input])).toThrow(
      TypeError,
    );
  });
  it("copies and freezes Quantity without mutating the caller", () => {
    const mutable = { unit: "kg" as const, milliUnits: -1250n };
    const input = { ...balance(), quantity: mutable };
    const result = stockBalance(input);
    expect(Object.isFrozen(mutable)).toBe(false);
    mutable.milliUnits = 999n;
    expect(result.quantity.milliUnits).toBe(-1250n);
    expect(result.quantity).not.toBe(mutable);
    expect(Reflect.set(result.quantity, "milliUnits", 0n)).toBe(false);
    expect(Reflect.set(result, "locationId", pid)).toBe(false);
    expect(Object.keys(result).sort()).toEqual([
      "locationId",
      "productId",
      "quantity",
    ]);
    expectTypeOf<StockBalance>().toEqualTypeOf<Readonly<StockBalance>>();
  });
  it("exports no direct stock mutators or location editing API", () => {
    for (const name of [
      "setStock",
      "increaseStock",
      "decreaseStock",
      "adjustStock",
      "replaceBalance",
      "renameInventoryLocation",
      "changeLocationCode",
      "activateLocation",
      "deactivateLocation",
    ])
      expect(Object.hasOwn(domain, name)).toBe(false);
  });
});

describe("Inventory runtime types", () => {
  const wrong: readonly unknown[] = [
    null,
    undefined,
    100,
    100n,
    true,
    [],
    {},
    new String("MAIN"),
    {
      toString() {
        throw Error("No coercion");
      },
    },
  ];
  it.each(wrong.map((value) => ({ value })))(
    "rejects malformed values without coercion",
    ({ value }) => {
      for (const factory of [
        inventoryLocationId,
        inventoryLocationCode,
        inventoryLocationName,
        createInventoryLocation,
        stockBalance,
      ])
        expect(() => Reflect.apply(factory, undefined, [value])).toThrow(
          TypeError,
        );
    },
  );
});

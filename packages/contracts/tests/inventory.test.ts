import { describe, expect, expectTypeOf, it } from "vitest";
import {
  InventoryLocationIdSchema,
  InventoryLocationCodeSchema,
  InventoryLocationNameSchema,
  InventoryLocationStatusSchema,
  InventoryLocationSchema,
  StockBalanceSchema,
  type InventoryLocationDto,
  type StockBalanceDto,
} from "../src/index";
const pid = "550e8400-e29b-41d4-a716-446655440000";
const lid = "550e8400-e29b-41d4-a716-446655440001";
const location = () => ({
  id: lid,
  code: "MAIN",
  name: "Piso de venta",
  status: "active",
});
const balance = () => ({
  productId: pid,
  locationId: lid,
  quantity: { unit: "piece", milliUnits: "5000" },
});

describe("Inventory field contracts", () => {
  const cases = [
    {
      schema: InventoryLocationIdSchema,
      valid: [
        lid,
        lid.toUpperCase(),
        "01890f3e-7bca-7cc1-98c4-dc0c0c07398f",
        "00000000-0000-0000-0000-000000000000",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
      ],
      invalid: [
        "",
        "invalid",
        lid.slice(0, -1),
        ` ${lid}`,
        `${lid}\n`,
        lid.replace("a716", "0716"),
      ],
    },
    {
      schema: InventoryLocationCodeSchema,
      valid: [
        "A",
        "0",
        "MAIN",
        "STORE-01",
        "WAREHOUSE_1",
        "BODEGA-A",
        "A__--B",
        "A".repeat(32),
      ],
      invalid: [
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
      ],
    },
    {
      schema: InventoryLocationNameSchema,
      valid: [
        "A",
        "Almacén principal",
        "Bodega Norte",
        "A  B",
        "Cafe\u0301",
        "🧑‍🍼",
        "商品",
        "A".repeat(100),
        "😀".repeat(100),
      ],
      invalid: [
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
      ],
    },
    {
      schema: InventoryLocationStatusSchema,
      valid: ["active", "inactive"],
      invalid: ["", "deleted", "archived", "Active"],
    },
  ];
  for (const { schema, valid, invalid } of cases) {
    it.each(valid)("preserves valid inventory field", (value) =>
      expect(schema.parse(value)).toBe(value),
    );
    it.each(invalid)("rejects invalid inventory field", (value) =>
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
      new String("MAIN"),
      {
        toString() {
          throw Error("No coercion");
        },
      },
    ];
    it.each(wrong.map((value) => ({ value })))(
      "rejects nonstring field",
      ({ value }) => expect(schema.safeParse(value).success).toBe(false),
    );
    it("rejects huge field input", () =>
      expect(schema.safeParse("A".repeat(1_000_000)).success).toBe(false));
  }
});

describe("InventoryLocationSchema", () => {
  it.each(["active", "inactive"])("round-trips valid %s location", (status) => {
    const input = { ...location(), status };
    const dto = InventoryLocationSchema.parse(input);
    expect(dto).toStrictEqual(input);
    const decoded: unknown = JSON.parse(JSON.stringify(dto));
    expect(InventoryLocationSchema.parse(decoded)).toStrictEqual(dto);
  });
  it.each(["id", "code", "name", "status"])("requires valid %s", (field) => {
    const input = location();
    Reflect.deleteProperty(input, field);
    expect(InventoryLocationSchema.safeParse(input).success).toBe(false);
    expect(
      InventoryLocationSchema.safeParse({
        ...location(),
        [field]: field === "name" ? "" : "invalid",
      }).success,
    ).toBe(false);
  });
  it("derives the DTO", () =>
    expectTypeOf<InventoryLocationDto>().toEqualTypeOf<{
      id: string;
      code: string;
      name: string;
      status: "active" | "inactive";
    }>());
});

describe("StockBalanceSchema", () => {
  it.each([
    "5000",
    "1250",
    "0",
    "-500",
    "9007199254740993123456789",
    "9".repeat(128),
    `-${"9".repeat(127)}`,
  ])("round-trips signed canonical quantity", (milliUnits) => {
    const input = { ...balance(), quantity: { unit: "kg", milliUnits } };
    const dto = StockBalanceSchema.parse(input);
    expect(dto).toStrictEqual(input);
    const decoded: unknown = JSON.parse(JSON.stringify(dto));
    expect(StockBalanceSchema.parse(decoded)).toStrictEqual(dto);
  });
  it.each(["piece", "kg", "g", "l", "ml", "m", "cm"])("preserves %s", (unit) =>
    expect(
      StockBalanceSchema.parse({
        ...balance(),
        quantity: { unit, milliUnits: "1" },
      }).quantity.unit,
    ).toBe(unit),
  );
  it.each(["productId", "locationId", "quantity"])(
    "requires valid %s",
    (field) => {
      const input = balance();
      Reflect.deleteProperty(input, field);
      expect(StockBalanceSchema.safeParse(input).success).toBe(false);
      expect(
        StockBalanceSchema.safeParse({ ...balance(), [field]: "invalid" })
          .success,
      ).toBe(false);
    },
  );
  const quantities: readonly unknown[] = [
    null,
    undefined,
    100,
    100n,
    [],
    {},
    "100",
    { unit: "KG", milliUnits: "100" },
    { unit: "kg", milliUnits: 100 },
    { unit: "kg", milliUnits: 100n },
    { unit: "kg", milliUnits: { nested: { value: "100" } } },
  ];
  it.each(quantities.map((value) => ({ value })))(
    "rejects malformed quantity",
    ({ value }) =>
      expect(
        StockBalanceSchema.safeParse({ ...balance(), quantity: value }).success,
      ).toBe(false),
  );
  it.each([
    "01",
    "-0",
    "+1",
    "1.5",
    "1e3",
    " 1",
    "1 ",
    "1\n",
    "１",
    "9".repeat(129),
    `-${"9".repeat(128)}`,
    "x".repeat(1_000_000),
  ])("rejects noncanonical or excessive quantity", (milliUnits) =>
    expect(
      StockBalanceSchema.safeParse({
        ...balance(),
        quantity: { unit: "kg", milliUnits },
      }).success,
    ).toBe(false),
  );
  it("derives string-based quantity DTO", () =>
    expectTypeOf<StockBalanceDto>().toEqualTypeOf<{
      productId: string;
      locationId: string;
      quantity: {
        unit: "piece" | "kg" | "g" | "l" | "ml" | "m" | "cm";
        milliUnits: string;
      };
    }>());
});

describe("Strict inventory objects", () => {
  it.each([
    "__proto__",
    "constructor",
    "extra",
    "tenantId",
    "companyId",
    "branchId",
    "warehouseId",
    "stock",
    "timestamp",
  ])("rejects JSON key %s at all levels", (key) => {
    const extra = { [key]: { polluted: true } };
    const loc: unknown = JSON.parse(
      JSON.stringify({ ...location(), ...extra }),
    );
    const bal: unknown = JSON.parse(JSON.stringify({ ...balance(), ...extra }));
    const nested: unknown = JSON.parse(
      JSON.stringify({
        ...balance(),
        quantity: { ...balance().quantity, ...extra },
      }),
    );
    expect(InventoryLocationSchema.safeParse(loc).success).toBe(false);
    expect(StockBalanceSchema.safeParse(bal).success).toBe(false);
    expect(StockBalanceSchema.safeParse(nested).success).toBe(false);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
  it.each(
    [
      null,
      undefined,
      100,
      100n,
      [],
      "value",
      { nested: { unexpected: [] } },
    ].map((value) => ({ value })),
  )("rejects malformed roots", ({ value }) => {
    expect(InventoryLocationSchema.safeParse(value).success).toBe(false);
    expect(StockBalanceSchema.safeParse(value).success).toBe(false);
  });
});

import { describe, expect, expectTypeOf, it } from "vitest";
import * as domain from "../src/index";
import {
  productId,
  inventoryLocationId,
  inventoryMovementId,
  inventoryAdjustmentReason,
  quantity,
  stockBalance,
  createInventoryReceipt,
  createInventoryIssue,
  createInventoryAdjustment,
  applyInventoryMovement,
  InventoryMovementTargetMismatchError,
  InvalidOperationalStockBalanceError,
  InsufficientStockError,
  IncompatibleQuantityUnitError,
  type InventoryMovement,
  type InventoryMovementId,
  type ProductId,
  type InventoryLocationId,
  type UnitCode,
} from "../src/index";

const ids = () => ({
  id: inventoryMovementId("550e8400-e29b-41d4-a716-446655440010"),
  productId: productId("550e8400-e29b-41d4-a716-446655440000"),
  locationId: inventoryLocationId("550e8400-e29b-41d4-a716-446655440001"),
});
const balance = (n = 10000n, unit: UnitCode = "piece") =>
  stockBalance({
    productId: ids().productId,
    locationId: ids().locationId,
    quantity: quantity(unit, n),
  });
const receipt = (n = 5000n, unit: UnitCode = "piece") =>
  createInventoryReceipt({
    ...ids(),
    type: "receipt",
    quantity: quantity(unit, n),
  });
const issue = (n = 2000n, unit: UnitCode = "piece") =>
  createInventoryIssue({
    ...ids(),
    type: "issue",
    quantity: quantity(unit, n),
  });
const adjustment = (n = -1000n, unit: UnitCode = "piece") =>
  createInventoryAdjustment({
    ...ids(),
    type: "adjustment",
    delta: quantity(unit, n),
    reason: inventoryAdjustmentReason("Corrección por conteo físico"),
  });
const units = ["piece", "kg", "g", "l", "ml", "m", "cm"] as const;

describe("InventoryMovement factories", () => {
  it("uses distinct nominal IDs and exactly three discriminants", () => {
    expectTypeOf<InventoryMovementId>().not.toExtend<ProductId>();
    expectTypeOf<InventoryMovementId>().not.toExtend<InventoryLocationId>();
    expectTypeOf<InventoryMovement["type"]>().toEqualTypeOf<
      "receipt" | "issue" | "adjustment"
    >();
    expect(inventoryMovementId(ids().id)).toBe(ids().id);
  });
  it.each(["", "bad", ids().id.slice(0, -1), ` ${ids().id}`, `${ids().id}\n`])(
    "rejects invalid movement ID",
    (id) => expect(() => inventoryMovementId(id)).toThrow(TypeError),
  );
  it.each(units)("creates exact independent %s movements", (unit) => {
    expect(receipt(1n, unit).quantity).toStrictEqual(quantity(unit, 1n));
    expect(issue(125n, unit).quantity).toStrictEqual(quantity(unit, 125n));
    expect(adjustment(-125n, unit).delta).toStrictEqual(quantity(unit, -125n));
  });
  it.each([1n, 1250n, 9007199254740993123456789n])(
    "allows positive magnitudes and signed adjustments",
    (n) => {
      expect(receipt(n).quantity.milliUnits).toBe(n);
      expect(issue(n).quantity.milliUnits).toBe(n);
      expect(adjustment(n).delta.milliUnits).toBe(n);
      expect(adjustment(-n).delta.milliUnits).toBe(-n);
    },
  );
  it.each([0n, -1n, -1000n])(
    "receipt/issue reject nonpositive magnitudes",
    (n) => {
      expect(() => receipt(n)).toThrow(TypeError);
      expect(() => issue(n)).toThrow(TypeError);
    },
  );
  it("rejects zero adjustment", () =>
    expect(() => adjustment(0n)).toThrow(TypeError));
  it.each([
    "A",
    "Corrección por conteo físico",
    "Merma detectada",
    "Error de captura anterior",
    "Cafe\u0301",
    "🧑‍🍼",
    "A  B",
    "A".repeat(200),
    "😀".repeat(200),
  ])("preserves valid reason", (reason) =>
    expect(inventoryAdjustmentReason(reason)).toBe(reason),
  );
  it.each([
    "",
    " ",
    "\u00a0",
    " A",
    "A ",
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
    "A".repeat(201),
    "😀".repeat(201),
  ])("rejects invalid reason", (reason) =>
    expect(() => inventoryAdjustmentReason(reason)).toThrow(TypeError),
  );
  it("copies nested values and freezes movements", () => {
    const q = { unit: "kg" as const, milliUnits: 125n };
    const a = createInventoryReceipt({
      ...ids(),
      type: "receipt",
      quantity: q,
    });
    const b = createInventoryIssue({ ...ids(), type: "issue", quantity: q });
    const c = createInventoryAdjustment({
      ...ids(),
      type: "adjustment",
      delta: q,
      reason: inventoryAdjustmentReason("Merma"),
    });
    q.milliUnits = 999n;
    for (const m of [a, b, c]) {
      expect(Object.isFrozen(m)).toBe(true);
      expect(Reflect.set(m, "type", "other")).toBe(false);
      const value = m.type === "adjustment" ? m.delta : m.quantity;
      expect(value.milliUnits).toBe(125n);
      expect(Reflect.set(value, "milliUnits", 0n)).toBe(false);
    }
    expect(Object.isFrozen(q)).toBe(false);
  });
});

describe("applyInventoryMovement", () => {
  it.each([
    { start: 10000n, m: receipt(), expected: 15000n },
    { start: 0n, m: receipt(), expected: 5000n },
    { start: 10000n, m: issue(), expected: 8000n },
    { start: 2000n, m: issue(), expected: 0n },
    { start: 10000n, m: adjustment(), expected: 9000n },
    { start: 10000n, m: adjustment(-2000n), expected: 8000n },
    { start: 10000n, m: adjustment(2000n), expected: 12000n },
    { start: 2000n, m: adjustment(-2000n), expected: 0n },
  ])("applies $m.type exactly to $start", ({ start, m, expected }) => {
    const original = balance(start);
    const previous = { ...m };
    const result = applyInventoryMovement(original, m);
    expect(result).toStrictEqual(balance(expected));
    expect(result).not.toBe(original);
    expect(original).toStrictEqual(balance(start));
    expect(m).toStrictEqual(previous);
    expect(Reflect.set(result.quantity, "milliUnits", -1n)).toBe(false);
    expect(Object.keys(result).sort()).toEqual([
      "locationId",
      "productId",
      "quantity",
    ]);
  });
  it.each(units)(
    "preserves thousandths and large exact magnitudes in %s",
    (unit) => {
      expect(
        applyInventoryMovement(balance(100n, unit), receipt(200n, unit))
          .quantity.milliUnits,
      ).toBe(300n);
      expect(
        applyInventoryMovement(balance(1000n, unit), issue(125n, unit)).quantity
          .milliUnits,
      ).toBe(875n);
      expect(
        applyInventoryMovement(balance(1000n, unit), adjustment(-125n, unit))
          .quantity.milliUnits,
      ).toBe(875n);
      const big = 9007199254740993123456789n;
      expect(
        applyInventoryMovement(balance(big, unit), receipt(1n, unit)).quantity
          .milliUnits,
      ).toBe(big + 1n);
    },
  );
  it.each([issue(3000n), adjustment(-3000n)])(
    "rejects negative final stock",
    (m) => {
      const original = balance(2000n);
      expect(() => applyInventoryMovement(original, m)).toThrow(
        InsufficientStockError,
      );
      expect(original).toStrictEqual(balance(2000n));
    },
  );
  it.each([receipt(5000n), issue(), adjustment(5000n), adjustment(-1000n)])(
    "rejects negative preexisting balance even if recoverable",
    (m) =>
      expect(() => applyInventoryMovement(balance(-1000n), m)).toThrow(
        InvalidOperationalStockBalanceError,
      ),
  );
  it.each([
    { productId: productId("550e8400-e29b-41d4-a716-446655440002") },
    { locationId: inventoryLocationId("550e8400-e29b-41d4-a716-446655440003") },
    {
      productId: productId("550e8400-e29b-41d4-a716-446655440002"),
      locationId: inventoryLocationId("550e8400-e29b-41d4-a716-446655440003"),
    },
  ])("rejects target mismatch for all movement kinds", (target) => {
    for (const m of [receipt(), issue(), adjustment()])
      expect(() =>
        applyInventoryMovement(balance(), { ...m, ...target }),
      ).toThrow(InventoryMovementTargetMismatchError);
  });
  it.each(
    units.flatMap((a) => units.filter((b) => a !== b).map((b) => ({ a, b }))),
  )("rejects $a vs $b without conversion", ({ a, b }) => {
    for (const m of [receipt(1n, b), issue(1n, b), adjustment(1n, b)])
      expect(() => applyInventoryMovement(balance(1000n, a), m)).toThrow(
        IncompatibleQuantityUnitError,
      );
  });
  it("does not deduplicate: applying the same ID twice applies twice", () => {
    const m = receipt(1000n);
    const once = applyInventoryMovement(balance(), m);
    const twice = applyInventoryMovement(once, m);
    expect(once.quantity.milliUnits).toBe(11000n);
    expect(twice.quantity.milliUnits).toBe(12000n);
    expect(applyInventoryMovement(balance(), m)).toStrictEqual(once);
  });
  it("exposes no direct stock mutators", () => {
    for (const name of [
      "setStock",
      "increaseStock",
      "decreaseStock",
      "adjustStock",
      "replaceBalance",
    ])
      expect(Object.hasOwn(domain, name)).toBe(false);
  });
});

describe("Movement runtime validation", () => {
  const wrong: readonly unknown[] = [
    null,
    undefined,
    100,
    100n,
    true,
    [],
    {},
    "",
    {
      toString() {
        throw Error("No coercion");
      },
    },
  ];
  it.each(wrong.map((value) => ({ value })))(
    "rejects wrong root types and primitives",
    ({ value }) => {
      for (const factory of [
        inventoryMovementId,
        inventoryAdjustmentReason,
        createInventoryReceipt,
        createInventoryIssue,
        createInventoryAdjustment,
      ])
        expect(() => Reflect.apply(factory, undefined, [value])).toThrow(
          TypeError,
        );
      expect(() =>
        Reflect.apply(applyInventoryMovement, undefined, [balance(), value]),
      ).toThrow(TypeError);
      expect(() =>
        Reflect.apply(applyInventoryMovement, undefined, [value, receipt()]),
      ).toThrow(TypeError);
    },
  );
  it.each(["id", "productId", "locationId", "type"])(
    "revalidates movement field %s",
    (field) => {
      for (const m of [receipt(), issue(), adjustment()]) {
        expect(() =>
          Reflect.apply(applyInventoryMovement, undefined, [
            balance(),
            { ...m, [field]: "bad" },
          ]),
        ).toThrow(TypeError);
        const partial = { ...m };
        Reflect.deleteProperty(partial, field);
        expect(() =>
          Reflect.apply(applyInventoryMovement, undefined, [
            balance(),
            partial,
          ]),
        ).toThrow(TypeError);
      }
    },
  );
  it.each(["receipt", "issue", "adjustment"] as const)(
    "rejects malformed %s factory input",
    (type) => {
      const m =
        type === "receipt"
          ? receipt()
          : type === "issue"
            ? issue()
            : adjustment();
      const factory =
        type === "receipt"
          ? createInventoryReceipt
          : type === "issue"
            ? createInventoryIssue
            : createInventoryAdjustment;
      const field = type === "adjustment" ? "delta" : "quantity";
      for (const value of [
        ...wrong,
        { unit: "KG", milliUnits: 1n },
        { unit: "kg", milliUnits: 1 },
        { unit: "kg", milliUnits: "1" },
        quantity("piece", 0n),
      ]) {
        const invalid = { ...m, [field]: value };
        expect(() => Reflect.apply(factory, undefined, [invalid])).toThrow(
          TypeError,
        );
        expect(() =>
          Reflect.apply(applyInventoryMovement, undefined, [
            balance(),
            invalid,
          ]),
        ).toThrow(TypeError);
      }
      expect(() =>
        Reflect.apply(factory, undefined, [{ ...m, type: "transfer" }]),
      ).toThrow(TypeError);
    },
  );
  it.each([undefined, null, "", " A", 100].map((reason) => ({ reason })))(
    "requires valid adjustment reason on direct application",
    ({ reason }) =>
      expect(() =>
        Reflect.apply(applyInventoryMovement, undefined, [
          balance(),
          { ...adjustment(), reason },
        ]),
      ).toThrow(TypeError),
  );
  it.each(["productId", "locationId", "quantity"])(
    "revalidates original balance %s",
    (field) =>
      expect(() =>
        Reflect.apply(applyInventoryMovement, undefined, [
          { ...balance(), [field]: "bad" },
          receipt(),
        ]),
      ).toThrow(TypeError),
  );
});

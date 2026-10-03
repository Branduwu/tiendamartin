import { describe, expect, expectTypeOf, it } from "vitest";
import {
  inventoryTransferId,
  createInventoryTransfer,
  createInventoryTransferMovements,
  applyInventoryTransfer,
  inventoryMovementId,
  productId,
  inventoryLocationId,
  quantity,
  stockBalance,
  InvalidInventoryTransferError,
  InventoryMovementTargetMismatchError,
  InvalidOperationalStockBalanceError,
  InsufficientStockError,
  IncompatibleQuantityUnitError,
  type InventoryTransfer,
  type InventoryTransferId,
  type InventoryMovementId,
  type ProductId,
  type UnitCode,
  type InventoryTransferResult,
} from "../src/index";
const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-4466554400${suffix}`;
const input = (n = 3000n, unit: UnitCode = "piece"): InventoryTransfer => ({
  id: inventoryTransferId(uuid("20")),
  issueMovementId: inventoryMovementId(uuid("21")),
  receiptMovementId: inventoryMovementId(uuid("22")),
  productId: productId(uuid("00")),
  sourceLocationId: inventoryLocationId(uuid("01")),
  destinationLocationId: inventoryLocationId(uuid("02")),
  quantity: quantity(unit, n),
});
const balance = (location: "01" | "02", n: bigint, unit: UnitCode = "piece") =>
  stockBalance({
    productId: productId(uuid("00")),
    locationId: inventoryLocationId(uuid(location)),
    quantity: quantity(unit, n),
  });
const units = ["piece", "kg", "g", "l", "ml", "m", "cm"] as const;

describe("InventoryTransfer", () => {
  it("validates nominal UUID without generating it", () => {
    expect(inventoryTransferId(uuid("20"))).toBe(uuid("20"));
    expectTypeOf<InventoryTransferId>().not.toExtend<InventoryMovementId>();
    expectTypeOf<InventoryTransferId>().not.toExtend<ProductId>();
  });
  it.each([
    "",
    "bad",
    uuid("20").slice(0, -1),
    ` ${uuid("20")}`,
    `${uuid("20")}\n`,
    uuid("20").replace("a716", "0716"),
  ])("rejects invalid UUID", (value) =>
    expect(() => inventoryTransferId(value)).toThrow(
      InvalidInventoryTransferError,
    ),
  );
  it.each(units)("preserves positive transfer in %s", (unit) =>
    expect(createInventoryTransfer(input(125n, unit))).toStrictEqual(
      input(125n, unit),
    ),
  );
  it.each([1n, 500n, 9007199254740993123456789n])(
    "accepts exact positive amount",
    (n) =>
      expect(createInventoryTransfer(input(n)).quantity.milliUnits).toBe(n),
  );
  it.each([0n, -1n, -500n])("rejects nonpositive quantity", (n) =>
    expect(() => createInventoryTransfer(input(n))).toThrow(TypeError),
  );
  it.each([false, true])(
    "rejects reused locations and child IDs irrespective of spelling case",
    (upper) => {
      const t = input();
      const loc = upper ? t.sourceLocationId.toUpperCase() : t.sourceLocationId;
      const mid = upper ? t.issueMovementId.toUpperCase() : t.issueMovementId;
      expect(() =>
        Reflect.apply(createInventoryTransfer, undefined, [
          { ...t, destinationLocationId: loc },
        ]),
      ).toThrow(InvalidInventoryTransferError);
      expect(() =>
        Reflect.apply(createInventoryTransfer, undefined, [
          { ...t, receiptMovementId: mid },
        ]),
      ).toThrow(InvalidInventoryTransferError);
    },
  );
  it("copies mutable Quantity and freezes transfer and derived pair", () => {
    const q = { unit: "kg" as const, milliUnits: 500n };
    const original = { ...input(), quantity: q };
    const t = createInventoryTransfer(original);
    const pair = createInventoryTransferMovements(t);
    q.milliUnits = -1n;
    expect(t.quantity.milliUnits).toBe(500n);
    expect(Object.isFrozen(q)).toBe(false);
    for (const obj of [
      t,
      t.quantity,
      pair,
      pair.issue,
      pair.receipt,
      pair.issue.quantity,
      pair.receipt.quantity,
    ])
      expect(Reflect.set(obj, "extra", true)).toBe(false);
  });
  it("derives the exact issue/source and receipt/destination using given IDs", () => {
    const t = createInventoryTransfer(input(500n, "kg"));
    const pair = createInventoryTransferMovements(t);
    expect(pair).toStrictEqual({
      issue: {
        id: t.issueMovementId,
        type: "issue",
        productId: t.productId,
        locationId: t.sourceLocationId,
        quantity: t.quantity,
      },
      receipt: {
        id: t.receiptMovementId,
        type: "receipt",
        productId: t.productId,
        locationId: t.destinationLocationId,
        quantity: t.quantity,
      },
    });
    expect(Object.keys(t).sort()).toEqual([
      "destinationLocationId",
      "id",
      "issueMovementId",
      "productId",
      "quantity",
      "receiptMovementId",
      "sourceLocationId",
    ]);
  });
});

describe("applyInventoryTransfer", () => {
  it.each([
    {
      source: 10000n,
      dest: 4000n,
      amount: 3000n,
      unit: "piece" as const,
      expectedSource: 7000n,
      expectedDest: 7000n,
    },
    {
      source: 1500n,
      dest: 250n,
      amount: 500n,
      unit: "kg" as const,
      expectedSource: 1000n,
      expectedDest: 750n,
    },
    {
      source: 5000n,
      dest: 0n,
      amount: 5000n,
      unit: "piece" as const,
      expectedSource: 0n,
      expectedDest: 5000n,
    },
    {
      source: 9007199254740993123456789n,
      dest: 9007199254740993123456789n,
      amount: 1n,
      unit: "l" as const,
      expectedSource: 9007199254740993123456788n,
      expectedDest: 9007199254740993123456790n,
    },
  ])(
    "returns both exact balances for $unit",
    ({ source, dest, amount, unit, expectedSource, expectedDest }) => {
      const a = balance("01", source, unit),
        b = balance("02", dest, unit),
        t = createInventoryTransfer(input(amount, unit));
      const result = applyInventoryTransfer(a, b, t);
      expect(result).toStrictEqual({
        sourceBalance: balance("01", expectedSource, unit),
        destinationBalance: balance("02", expectedDest, unit),
      });
      expect(result.sourceBalance).not.toBe(a);
      expect(result.destinationBalance).not.toBe(b);
      expect(a).toStrictEqual(balance("01", source, unit));
      expect(b).toStrictEqual(balance("02", dest, unit));
      expect(t).toStrictEqual(input(amount, unit));
      for (const obj of [
        result,
        result.sourceBalance,
        result.destinationBalance,
        result.sourceBalance.quantity,
        result.destinationBalance.quantity,
      ])
        expect(Reflect.set(obj, "extra", true)).toBe(false);
    },
  );
  it("rejects insufficient stock without either observable result", () => {
    const a = balance("01", 2000n),
      b = balance("02", 4000n),
      t = input();
    let result: InventoryTransferResult | undefined;
    expect(() => {
      result = applyInventoryTransfer(a, b, t);
    }).toThrow(InsufficientStockError);
    expect(result).toBeUndefined();
    expect(a).toStrictEqual(balance("01", 2000n));
    expect(b).toStrictEqual(balance("02", 4000n));
    expect(t).toStrictEqual(input());
  });
  it.each([
    [-1n, 0n],
    [10000n, -1n],
    [-1n, -1n],
  ] as const)("rejects preexisting negative source/destination", (a, b) => {
    const source = balance("01", a),
      destination = balance("02", b);
    expect(() => applyInventoryTransfer(source, destination, input())).toThrow(
      InvalidOperationalStockBalanceError,
    );
    expect(source.quantity.milliUnits).toBe(a);
    expect(destination.quantity.milliUnits).toBe(b);
  });
  it.each(["source", "destination"] as const)(
    "rejects wrong target on %s",
    (side) => {
      for (const patch of [
        { productId: productId(uuid("03")) },
        { locationId: inventoryLocationId(uuid("04")) },
      ]) {
        const a = balance("01", 10000n),
          b = balance("02", 4000n);
        const source = side === "source" ? stockBalance({ ...a, ...patch }) : a;
        const destination =
          side === "destination" ? stockBalance({ ...b, ...patch }) : b;
        expect(() =>
          applyInventoryTransfer(source, destination, input()),
        ).toThrow(InventoryMovementTargetMismatchError);
        expect(a.quantity.milliUnits).toBe(10000n);
        expect(b.quantity.milliUnits).toBe(4000n);
      }
    },
  );
  it("rejects swapped balances, shared balance location and mismatched transfer product", () => {
    const a = balance("01", 10000n),
      b = balance("02", 4000n);
    expect(() => applyInventoryTransfer(b, a, input())).toThrow(
      InventoryMovementTargetMismatchError,
    );
    expect(() => applyInventoryTransfer(a, a, input())).toThrow(
      InventoryMovementTargetMismatchError,
    );
    expect(() =>
      applyInventoryTransfer(a, b, {
        ...input(),
        productId: productId(uuid("03")),
      }),
    ).toThrow(InventoryMovementTargetMismatchError);
  });
  it.each(
    units.flatMap((a) => units.filter((b) => a !== b).map((b) => ({ a, b }))),
  )("rejects unit mismatch $a vs $b on either side", ({ a, b }) => {
    expect(() =>
      applyInventoryTransfer(
        balance("01", 10000n, b),
        balance("02", 0n, a),
        input(1n, a),
      ),
    ).toThrow(IncompatibleQuantityUnitError);
    expect(() =>
      applyInventoryTransfer(
        balance("01", 10000n, a),
        balance("02", 0n, b),
        input(1n, a),
      ),
    ).toThrow(IncompatibleQuantityUnitError);
  });
  it("does not expose a reduced source when destination is invalid", () => {
    const a = {
      ...balance("01", 10000n),
      quantity: { unit: "kg" as const, milliUnits: 10000n },
    };
    const b = {
      ...balance("02", 0n),
      quantity: { unit: "g" as const, milliUnits: 0n },
    };
    const t = input(500n, "kg");
    let result: InventoryTransferResult | undefined;
    expect(() => {
      result = applyInventoryTransfer(a, b, t);
    }).toThrow(IncompatibleQuantityUnitError);
    expect(result).toBeUndefined();
    expect(a.quantity.milliUnits).toBe(10000n);
    expect(b.quantity.milliUnits).toBe(0n);
    expect(t).toStrictEqual(input(500n, "kg"));
    expect(Object.isFrozen(a)).toBe(false);
  });
  it("applies the same transfer twice without deduplication", () => {
    const t = input(2000n);
    const once = applyInventoryTransfer(
      balance("01", 10000n),
      balance("02", 0n),
      t,
    );
    const twice = applyInventoryTransfer(
      once.sourceBalance,
      once.destinationBalance,
      t,
    );
    expect([
      once.sourceBalance.quantity.milliUnits,
      once.destinationBalance.quantity.milliUnits,
    ]).toEqual([8000n, 2000n]);
    expect([
      twice.sourceBalance.quantity.milliUnits,
      twice.destinationBalance.quantity.milliUnits,
    ]).toEqual([6000n, 4000n]);
  });
});

describe("Transfer runtime guards", () => {
  const wrong: readonly unknown[] = [
    null,
    undefined,
    100,
    100n,
    true,
    [],
    {},
    "bad",
    {
      toString() {
        throw Error("No coercion");
      },
    },
  ];
  it.each(wrong.map((value) => ({ value })))(
    "rejects forged roots",
    ({ value }) => {
      for (const factory of [
        inventoryTransferId,
        createInventoryTransfer,
        createInventoryTransferMovements,
      ])
        expect(() => Reflect.apply(factory, undefined, [value])).toThrow(
          TypeError,
        );
      expect(() =>
        Reflect.apply(applyInventoryTransfer, undefined, [
          balance("01", 10000n),
          balance("02", 0n),
          value,
        ]),
      ).toThrow(TypeError);
      expect(() =>
        Reflect.apply(applyInventoryTransfer, undefined, [
          value,
          balance("02", 0n),
          input(),
        ]),
      ).toThrow(TypeError);
      expect(() =>
        Reflect.apply(applyInventoryTransfer, undefined, [
          balance("01", 10000n),
          value,
          input(),
        ]),
      ).toThrow(TypeError);
    },
  );
  it.each([
    "id",
    "issueMovementId",
    "receiptMovementId",
    "productId",
    "sourceLocationId",
    "destinationLocationId",
    "quantity",
  ])("requires and revalidates %s", (field) => {
    const partial = { ...input() };
    Reflect.deleteProperty(partial, field);
    for (const invalid of [partial, { ...input(), [field]: "bad" }]) {
      expect(() =>
        Reflect.apply(createInventoryTransfer, undefined, [invalid]),
      ).toThrow(TypeError);
      expect(() =>
        Reflect.apply(createInventoryTransferMovements, undefined, [invalid]),
      ).toThrow(TypeError);
      expect(() =>
        Reflect.apply(applyInventoryTransfer, undefined, [
          balance("01", 10000n),
          balance("02", 0n),
          invalid,
        ]),
      ).toThrow(TypeError);
    }
  });
  it.each(
    [
      null,
      100,
      100n,
      [],
      { unit: "KG", milliUnits: 1n },
      { unit: "kg", milliUnits: "1" },
      { unit: "kg", milliUnits: 1 },
    ].map((value) => ({ value })),
  )("rejects forged Quantity", ({ value }) =>
    expect(() =>
      Reflect.apply(createInventoryTransfer, undefined, [
        { ...input(), quantity: value },
      ]),
    ).toThrow(TypeError),
  );
});

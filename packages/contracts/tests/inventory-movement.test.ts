import { describe, expect, expectTypeOf, it } from "vitest";
import {
  InventoryMovementIdSchema,
  InventoryAdjustmentReasonSchema,
  InventoryReceiptSchema,
  InventoryIssueSchema,
  InventoryAdjustmentSchema,
  InventoryMovementSchema,
  QuantitySchema,
  type InventoryMovementDto,
} from "../src/index";
const ids = {
  id: "550e8400-e29b-41d4-a716-446655440010",
  productId: "550e8400-e29b-41d4-a716-446655440000",
  locationId: "550e8400-e29b-41d4-a716-446655440001",
};
const receipt = {
  ...ids,
  type: "receipt",
  quantity: { unit: "piece", milliUnits: "5000" },
};
const issue = {
  ...ids,
  type: "issue",
  quantity: { unit: "piece", milliUnits: "2000" },
};
const adjustment = {
  ...ids,
  type: "adjustment",
  delta: { unit: "piece", milliUnits: "-1000" },
  reason: "Corrección por conteo físico",
};
const cases = [
  { schema: InventoryReceiptSchema, input: receipt, field: "quantity" },
  { schema: InventoryIssueSchema, input: issue, field: "quantity" },
  { schema: InventoryAdjustmentSchema, input: adjustment, field: "delta" },
];

describe("InventoryMovement contracts", () => {
  for (const { schema, input, field } of cases) {
    it(`${input.type} round-trips strict JSON`, () => {
      expect(schema.parse(input)).toStrictEqual(input);
      const decoded: unknown = JSON.parse(JSON.stringify(input));
      expect(InventoryMovementSchema.parse(decoded)).toStrictEqual(input);
    });
    it.each(["piece", "kg", "g", "l", "ml", "m", "cm"])(
      `${input.type} supports unit %s`,
      (unit) =>
        expect(
          schema.safeParse({ ...input, [field]: { unit, milliUnits: "125" } })
            .success,
        ).toBe(true),
    );
    it.each(["1", "9007199254740993123456789", "9".repeat(128)])(
      `${input.type} accepts exact positive magnitude`,
      (milliUnits) =>
        expect(
          schema.safeParse({ ...input, [field]: { unit: "kg", milliUnits } })
            .success,
        ).toBe(true),
    );
    it.each([
      "0",
      "-0",
      "01",
      "+1",
      "1.5",
      "1e3",
      " 1",
      "1 ",
      "1\n",
      "１",
      "9".repeat(129),
      "x".repeat(1_000_000),
    ])(`${input.type} rejects zero or noncanonical amount`, (milliUnits) =>
      expect(
        schema.safeParse({ ...input, [field]: { unit: "kg", milliUnits } })
          .success,
      ).toBe(false),
    );
    it.each(
      [
        null,
        undefined,
        100,
        100n,
        [],
        {},
        "1",
        { unit: "KG", milliUnits: "1" },
        { unit: "kg", milliUnits: 100 },
        { unit: "kg", milliUnits: 100n },
      ].map((value) => ({ value })),
    )(`${input.type} rejects malformed quantity`, ({ value }) =>
      expect(schema.safeParse({ ...input, [field]: value }).success).toBe(
        false,
      ),
    );
    it.each(["id", "productId", "locationId", "type", field])(
      `${input.type} requires valid %s`,
      (key) => {
        const partial = { ...input };
        Reflect.deleteProperty(partial, key);
        expect(schema.safeParse(partial).success).toBe(false);
        expect(schema.safeParse({ ...input, [key]: "bad" }).success).toBe(
          false,
        );
      },
    );
    it.each([
      "__proto__",
      "constructor",
      "extra",
      "tenantId",
      "createdAt",
      "createdBy",
      "lastMovementId",
    ])(`${input.type} rejects extra JSON key %s`, (key) => {
      const root: unknown = JSON.parse(
        JSON.stringify({ ...input, [key]: { polluted: true } }),
      );
      const nested: unknown = JSON.parse(
        JSON.stringify({
          ...input,
          [field]: { unit: "kg", milliUnits: "1", [key]: { polluted: true } },
        }),
      );
      expect(schema.safeParse(root).success).toBe(false);
      expect(InventoryMovementSchema.safeParse(root).success).toBe(false);
      expect(schema.safeParse(nested).success).toBe(false);
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    });
  }
  it.each(["-1", `-${"9".repeat(127)}`])(
    "only adjustment accepts negative delta",
    (milliUnits) => {
      expect(
        InventoryAdjustmentSchema.safeParse({
          ...adjustment,
          delta: { unit: "piece", milliUnits },
        }).success,
      ).toBe(true);
      for (const input of [receipt, issue])
        expect(
          InventoryMovementSchema.safeParse({
            ...input,
            quantity: { unit: "piece", milliUnits },
          }).success,
        ).toBe(false);
    },
  );
  it("rejects mixed variant fields", () => {
    expect(
      InventoryMovementSchema.safeParse({ ...receipt, delta: adjustment.delta })
        .success,
    ).toBe(false);
    expect(
      InventoryMovementSchema.safeParse({ ...issue, reason: "extra" }).success,
    ).toBe(false);
    expect(
      InventoryMovementSchema.safeParse({
        ...adjustment,
        quantity: receipt.quantity,
      }).success,
    ).toBe(false);
  });
  it.each(
    [
      "transfer",
      "sale",
      "purchase",
      "return",
      "count",
      "Receipt",
      null,
      undefined,
      100,
    ].map((type) => ({ type })),
  )("rejects unsupported discriminators", ({ type }) =>
    expect(
      InventoryMovementSchema.safeParse({ ...receipt, type }).success,
    ).toBe(false),
  );
  it.each(
    [null, undefined, 100, 100n, [], {}, "receipt"].map((value) => ({ value })),
  )("rejects malformed roots", ({ value }) => {
    for (const schema of [
      InventoryMovementSchema,
      InventoryReceiptSchema,
      InventoryIssueSchema,
      InventoryAdjustmentSchema,
    ])
      expect(schema.safeParse(value).success).toBe(false);
  });
  it("preserves globally signed Quantity and derives discriminated DTO", () => {
    for (const milliUnits of ["0", "-1"])
      expect(QuantitySchema.safeParse({ unit: "kg", milliUnits }).success).toBe(
        true,
      );
    expectTypeOf<InventoryMovementDto["type"]>().toEqualTypeOf<
      "receipt" | "issue" | "adjustment"
    >();
  });
});

describe("Movement ID and reason", () => {
  it.each([
    ids.id,
    ids.id.toUpperCase(),
    "01890f3e-7bca-7cc1-98c4-dc0c0c07398f",
  ])("preserves valid ID", (value) =>
    expect(InventoryMovementIdSchema.parse(value)).toBe(value),
  );
  it.each(["", "bad", ids.id.slice(0, -1), ` ${ids.id}`, `${ids.id}\n`])(
    "rejects invalid ID",
    (value) =>
      expect(InventoryMovementIdSchema.safeParse(value).success).toBe(false),
  );
  it.each([
    "A",
    "Corrección por conteo físico",
    "Merma detectada",
    "A  B",
    "Cafe\u0301",
    "🧑‍🍼",
    "A".repeat(200),
    "😀".repeat(200),
  ])("preserves visible Unicode reason", (reason) => {
    expect(InventoryAdjustmentReasonSchema.parse(reason)).toBe(reason);
    expect(
      InventoryAdjustmentSchema.parse({ ...adjustment, reason }).reason,
    ).toBe(reason);
  });
  it.each([
    "",
    " ",
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
    "x".repeat(1_000_000),
  ])("rejects invalid reason", (reason) => {
    expect(InventoryAdjustmentReasonSchema.safeParse(reason).success).toBe(
      false,
    );
    expect(
      InventoryAdjustmentSchema.safeParse({ ...adjustment, reason }).success,
    ).toBe(false);
  });
  it.each(
    [
      null,
      undefined,
      100,
      100n,
      true,
      [],
      {},
      {
        toString() {
          throw Error("No coercion");
        },
      },
    ].map((value) => ({ value })),
  )("rejects nonstring ID/reason", ({ value }) => {
    expect(InventoryMovementIdSchema.safeParse(value).success).toBe(false);
    expect(InventoryAdjustmentReasonSchema.safeParse(value).success).toBe(
      false,
    );
    expect(
      InventoryAdjustmentSchema.safeParse({ ...adjustment, reason: value })
        .success,
    ).toBe(false);
  });
  it("requires reason", () => {
    const partial = { ...adjustment };
    Reflect.deleteProperty(partial, "reason");
    expect(InventoryAdjustmentSchema.safeParse(partial).success).toBe(false);
  });
});

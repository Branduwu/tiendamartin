import { describe, expect, expectTypeOf, it } from "vitest";
import {
  InventoryTransferIdSchema,
  InventoryTransferSchema,
  InventoryMovementSchema,
  QuantitySchema,
  type InventoryTransferDto,
} from "../src/index";
const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-4466554400${suffix}`;
const input = () => ({
  id: uuid("20"),
  issueMovementId: uuid("21"),
  receiptMovementId: uuid("22"),
  productId: uuid("00"),
  sourceLocationId: uuid("01"),
  destinationLocationId: uuid("02"),
  quantity: { unit: "piece", milliUnits: "5000" },
});

describe("InventoryTransferSchema", () => {
  it("round-trips strict JSON and derives a serializable DTO", () => {
    const dto = InventoryTransferSchema.parse(input());
    expect(dto).toStrictEqual(input());
    const decoded: unknown = JSON.parse(JSON.stringify(dto));
    expect(InventoryTransferSchema.parse(decoded)).toStrictEqual(dto);
    expectTypeOf<
      InventoryTransferDto["quantity"]["milliUnits"]
    >().toEqualTypeOf<string>();
  });
  it.each(["piece", "kg", "g", "l", "ml", "m", "cm"])(
    "accepts unit %s",
    (unit) =>
      expect(
        InventoryTransferSchema.parse({
          ...input(),
          quantity: { unit, milliUnits: "125" },
        }).quantity,
      ).toStrictEqual({ unit, milliUnits: "125" }),
  );
  it.each(["1", "9007199254740993123456789", "9".repeat(128)])(
    "accepts large positive canonical quantity",
    (milliUnits) =>
      expect(
        InventoryTransferSchema.safeParse({
          ...input(),
          quantity: { unit: "kg", milliUnits },
        }).success,
      ).toBe(true),
  );
  it.each([
    "0",
    "-1",
    "-0",
    "01",
    "+1",
    "1.5",
    "1e3",
    " 1",
    "1 ",
    "1\n",
    "1\r",
    "1\0",
    "1\u200b",
    "１",
    "9".repeat(129),
    "x".repeat(1_000_000),
  ])("rejects nonpositive/noncanonical/excessive quantity", (milliUnits) =>
    expect(
      InventoryTransferSchema.safeParse({
        ...input(),
        quantity: { unit: "kg", milliUnits },
      }).success,
    ).toBe(false),
  );
  it.each([false, true])(
    "rejects reused child IDs and same source/destination with case variants",
    (upper) => {
      const t = input();
      expect(
        InventoryTransferSchema.safeParse({
          ...t,
          receiptMovementId: upper
            ? t.issueMovementId.toUpperCase()
            : t.issueMovementId,
        }).success,
      ).toBe(false);
      expect(
        InventoryTransferSchema.safeParse({
          ...t,
          destinationLocationId: upper
            ? t.sourceLocationId.toUpperCase()
            : t.sourceLocationId,
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    "id",
    "issueMovementId",
    "receiptMovementId",
    "productId",
    "sourceLocationId",
    "destinationLocationId",
  ])("validates UUID field %s and its presence", (field) => {
    const partial = input();
    Reflect.deleteProperty(partial, field);
    expect(InventoryTransferSchema.safeParse(partial).success).toBe(false);
    for (const value of [
      "bad",
      `${uuid("20")}\n`,
      ` ${uuid("20")}`,
      uuid("20").slice(0, -1),
      "x".repeat(1_000_000),
      null,
      100,
      100n,
      {},
    ])
      expect(
        InventoryTransferSchema.safeParse({ ...input(), [field]: value })
          .success,
      ).toBe(false);
  });
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
      { unit: "kg", milliUnits: 1 },
      { unit: "kg", milliUnits: 1n },
    ].map((value) => ({ value })),
  )("rejects malformed Quantity", ({ value }) =>
    expect(
      InventoryTransferSchema.safeParse({ ...input(), quantity: value })
        .success,
    ).toBe(false),
  );
  it.each([
    "__proto__",
    "constructor",
    "extra",
    "type",
    "status",
    "comments",
    "tenantId",
    "createdAt",
    "createdBy",
    "history",
  ])("rejects extra key %s at root and quantity", (key) => {
    const root: unknown = JSON.parse(
      JSON.stringify({ ...input(), [key]: { polluted: true } }),
    );
    const nested: unknown = JSON.parse(
      JSON.stringify({
        ...input(),
        quantity: { ...input().quantity, [key]: { polluted: true } },
      }),
    );
    expect(InventoryTransferSchema.safeParse(root).success).toBe(false);
    expect(InventoryTransferSchema.safeParse(nested).success).toBe(false);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
  it.each(
    [
      null,
      undefined,
      100,
      100n,
      [],
      {},
      "transfer",
      {
        toString() {
          throw Error("No coercion");
        },
      },
    ].map((value) => ({ value })),
  )("rejects malformed roots and ID types", ({ value }) => {
    expect(InventoryTransferSchema.safeParse(value).success).toBe(false);
    expect(InventoryTransferIdSchema.safeParse(value).success).toBe(false);
  });
  it("does not add a transfer movement type or change signed Quantity", () => {
    expect(
      InventoryMovementSchema.safeParse({ ...input(), type: "transfer" })
        .success,
    ).toBe(false);
    expect(
      QuantitySchema.safeParse({ unit: "kg", milliUnits: "-1" }).success,
    ).toBe(true);
    expect(InventoryTransferIdSchema.parse(uuid("20"))).toBe(uuid("20"));
  });
});

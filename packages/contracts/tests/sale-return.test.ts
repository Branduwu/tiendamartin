import { expect, it } from "vitest";
import { CreateSaleReturnSchema } from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440001",
  mid = "550e8400-e29b-41d4-a716-446655440002";
const body = {
  id,
  lines: [
    {
      saleLineId: id,
      productId: id,
      quantity: { unit: "piece", milliUnits: "1000" },
      movementId: mid,
    },
  ],
  refunds: [{ method: "card", amount: { currency: "MXN", minorUnits: "125" } }],
};
it("strict return accepts serialized quantities and refunds only", () => {
  expect(CreateSaleReturnSchema.parse(body)).toEqual(body);
});
it("rejects price/total/actor/location authority from client", () => {
  for (const extra of [
    { total: "125" },
    { unitPrice: "125" },
    { userId: id },
    { role: "owner" },
    { locationId: id },
  ])
    expect(
      CreateSaleReturnSchema.safeParse({ ...body, ...extra }).success,
    ).toBe(false);
});
it("malformed canonical quantities never throw or coerce", () => {
  for (const milliUnits of [
    1000,
    "abc",
    "1e3",
    "1.25",
    "01",
    "0",
    "-1",
    "1",
    "1".repeat(129),
  ])
    expect(
      CreateSaleReturnSchema.safeParse({
        ...body,
        lines: [{ ...body.lines[0], quantity: { unit: "piece", milliUnits } }],
      }).success,
    ).toBe(false);
});
it("rejects repeated receipts, methods and mismatched line IDs", () => {
  expect(
    CreateSaleReturnSchema.safeParse({
      ...body,
      lines: [...body.lines, ...body.lines],
    }).success,
  ).toBe(false);
  expect(
    CreateSaleReturnSchema.safeParse({
      ...body,
      refunds: [...body.refunds, ...body.refunds],
    }).success,
  ).toBe(false);
  expect(
    CreateSaleReturnSchema.safeParse({
      ...body,
      lines: [{ ...body.lines[0], saleLineId: mid }],
    }).success,
  ).toBe(false);
});
it("allows zero-value refund without payments and bounds line count", () => {
  expect(
    CreateSaleReturnSchema.safeParse({ ...body, refunds: [] }).success,
  ).toBe(true);
  expect(CreateSaleReturnSchema.safeParse({ ...body, lines: [] }).success).toBe(
    false,
  );
  expect(
    CreateSaleReturnSchema.safeParse({
      ...body,
      lines: Array.from({ length: 1001 }, () => body.lines[0]),
    }).success,
  ).toBe(false);
});

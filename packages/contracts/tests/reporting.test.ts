import { expect, it } from "vitest";
import { ReportQuerySchema } from "../src/reporting";
it("provides explicit today and one base unit low stock defaults", () => {
  expect(ReportQuerySchema.parse({})).toEqual({
    period: "today",
    lowStockMilliUnits: "1000",
  });
});
it("requires custom endpoints and rejects ignored dates on presets", () => {
  expect(
    ReportQuerySchema.safeParse({
      period: "custom",
      from: "2026-10-01",
      to: "2026-10-03",
    }).success,
  ).toBe(true);
  for (const input of [
    { period: "custom" },
    { period: "custom", from: "2026-10-01" },
    { period: "7d", to: "2026-10-03" },
  ])
    expect(ReportQuerySchema.safeParse(input).success).toBe(false);
});
it("denies arbitrary keys tenant/user/role and invalid references", () => {
  for (const input of [
    { tenantId: "forged" },
    { userId: "forged" },
    { role: "owner" },
    { productId: "invalid" },
  ])
    expect(ReportQuerySchema.safeParse(input).success).toBe(false);
});
it("never coerces numeric stock threshold or unknown payment method", () => {
  for (const input of [
    { lowStockMilliUnits: 1000 },
    { lowStockMilliUnits: "1000.0" },
    { paymentMethod: "crypto" },
  ])
    expect(ReportQuerySchema.safeParse(input).success).toBe(false);
});

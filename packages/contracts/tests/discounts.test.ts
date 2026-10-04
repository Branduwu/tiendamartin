import { describe, it, expect } from "vitest";
import {
  DiscountSchema,
  CouponInputSchema,
  CouponCodeSchema,
  DiscountIntentSchema,
  PromotionInputSchema,
} from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440100",
  coupon = {
    id,
    code: "SMOKE",
    discount: { type: "percentage", value: "2000" },
    active: true,
  };
describe("discount contracts", () => {
  it("accepts canonical integer cents/basis points and rejects invalid types without throwing", () => {
    expect(DiscountSchema.safeParse(coupon.discount).success).toBe(true);
    for (const v of [
      null,
      {},
      1,
      { type: "percentage", value: "10001" },
      { type: "amount", value: "01" },
      { type: "amount", value: 1 },
      { type: "amount", value: 1n },
      { type: "percentage", value: "wrong" },
      { type: "amount", value: "1e3" },
      { type: "amount", value: "9".repeat(129) },
      { type: "amount", value: "1", unexpected: true },
    ])
      expect(DiscountSchema.safeParse(v).success).toBe(false);
  });
  it("normalizes coupon codes and validates dates and limits safely", () => {
    expect(CouponCodeSchema.parse(" smoke-1 ")).toBe("SMOKE-1");
    expect(CouponInputSchema.safeParse(coupon).success).toBe(true);
    for (const v of [
      { ...coupon, code: "a b" },
      { ...coupon, usageLimit: "0" },
      { ...coupon, usageLimit: "abc" },
      { ...coupon, usageLimit: "9223372036854775808" },
      {
        ...coupon,
        startsAt: "2026-10-03T10:00:00Z",
        endsAt: "2026-10-03T09:00:00Z",
      },
      { ...coupon, active: "true" },
      { ...coupon, role: "owner" },
    ])
      expect(CouponInputSchema.safeParse(v).success).toBe(false);
  });
  it("rejects duplicate line intents and client fields without coercion", () => {
    const line = { productId: id, discount: coupon.discount };
    expect(
      DiscountIntentSchema.safeParse({ lines: [line], couponCode: "smoke" })
        .success,
    ).toBe(true);
    for (const value of [
      { lines: [line, line] },
      { sale: { type: "amount", value: "-1" } },
      { role: "owner" },
      { couponCode: "" },
      { couponCode: 123 },
    ])
      expect(DiscountIntentSchema.safeParse(value).success).toBe(false);
  });
  it("requires tenant-scoped product identity and a sensible promotion period", () => {
    const p = {
      id,
      name: "Promo",
      productId: id,
      discount: coupon.discount,
      active: true,
    };
    expect(PromotionInputSchema.safeParse(p).success).toBe(true);
    expect(
      PromotionInputSchema.safeParse({ ...p, productId: "bad" }).success,
    ).toBe(false);
    expect(
      PromotionInputSchema.safeParse({ ...p, startsAt: "bad" }).success,
    ).toBe(false);
  });
});

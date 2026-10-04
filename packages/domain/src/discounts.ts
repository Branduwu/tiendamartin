import { money } from "./money";
import {
  completeSale,
  calculateSaleLineTotal,
  type CompletedSale,
  type SaleDraft,
} from "./sale";
import { productId } from "./product-fields";

/** Percentage values are integer basis points: 2000n = 20.00%. */
export type Discount = Readonly<{
  type: "amount" | "percentage";
  value: bigint;
}>;
export type DiscountIntent = Readonly<{
  sale?: Discount;
  lines?: readonly Readonly<{ productId: string; discount: Discount }>[];
  couponCode?: string;
}>;
export type DiscountRule = Readonly<{
  id: string;
  discount: Discount;
  productId?: string;
  name?: string;
  code?: string;
}>;
type Description = Readonly<{ type: Discount["type"]; value: string }>;
/** Immutable explanations; monetary values are canonical minor-unit strings. */
export type DiscountDetails = Readonly<{
  lineDiscountTotal: string;
  saleDiscountTotal: string;
  couponDiscountTotal: string;
  manualSale?: Description;
  coupon?: Description & Readonly<{ id: string; code: string }>;
  lines: readonly (Description &
    Readonly<{
      productId: string;
      source: "none" | "manual" | "promotion";
      lineDiscount: string;
      saleAllocation: string;
      couponAllocation: string;
      promotionId?: string;
      promotionName?: string;
    }>)[];
}>;
export class DiscountUnavailableError extends Error {}
export class DiscountLimitError extends Error {}
export function discount(type: Discount["type"], value: bigint): Discount {
  if (
    (type !== "amount" && type !== "percentage") ||
    typeof value !== "bigint" ||
    value < 0n ||
    (type === "percentage" && value > 10000n)
  )
    throw new TypeError("Invalid discount");
  return Object.freeze({ type, value });
}
export function couponCode(value: string): string {
  if (typeof value !== "string" || value.length > 64)
    throw new TypeError("Invalid coupon code");
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code))
    throw new TypeError("Invalid coupon code");
  return code;
}
/** HALF-UP once per discount against nonnegative integer cents. */
export function discountAmount(
  base: bigint,
  spec: Discount,
  clamp = false,
): bigint {
  const valid = discount(spec.type, spec.value);
  if (typeof base !== "bigint" || base < 0n)
    throw new TypeError("Invalid discount base");
  const amount =
    valid.type === "amount"
      ? valid.value
      : (base * valid.value + 5000n) / 10000n;
  if (amount > base && !clamp) throw new TypeError("Discount exceeds subtotal");
  return amount > base ? base : amount;
}
/** Largest remainder, UUID tie-break, conserves every cent without floating point. */
function allocate(
  amount: bigint,
  lines: readonly { productId: string; paid: bigint }[],
): bigint[] {
  const total = lines.reduce((s, l) => s + l.paid, 0n);
  if (amount === 0n || total === 0n) return lines.map(() => 0n);
  const values = lines.map((l) => (amount * l.paid) / total);
  let remaining = amount - values.reduce((s, v) => s + v, 0n);
  const order = lines
    .map((l, index) => ({
      index,
      id: l.productId,
      remainder: (amount * l.paid) % total,
    }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.id.localeCompare(b.id)
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  for (const entry of order) {
    if (remaining === 0n) break;
    values[entry.index] = (values[entry.index] ?? 0n) + 1n;
    remaining -= 1n;
  }
  return values;
}
export function priceDiscountedSale(
  draft: SaleDraft,
  intent: DiscountIntent = {},
  promotions: readonly DiscountRule[] = [],
  coupon?: DiscountRule,
  cashier = false,
): Readonly<{ sale: CompletedSale; details?: DiscountDetails }> {
  const original = completeSale(draft);
  if (original.lines.some((l) => l.discount !== undefined))
    throw new TypeError("Expected undiscounted draft");
  const manual = intent.lines ?? [];
  const ids = manual.map((l) => productId(l.productId).toLowerCase());
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !original.lines.some((l) => l.productId === id))
  )
    throw new TypeError("Invalid discounted line");
  if (
    intent.couponCode !== undefined &&
    (!coupon || couponCode(intent.couponCode) !== coupon.code)
  )
    throw new DiscountUnavailableError("Coupon unavailable");
  const explanations: Omit<
    DiscountDetails["lines"][number],
    "lineDiscount" | "saleAllocation" | "couponAllocation"
  >[] = [];
  let manualTotal = 0n;
  const values = original.lines.map((l) => {
    const base = calculateSaleLineTotal(l.unitPrice, l.quantity).minorUnits;
    const request = manual.find(
      (m) => productId(m.productId).toLowerCase() === l.productId,
    );
    let amount = 0n;
    if (request) {
      amount = discountAmount(base, request.discount);
      if (cashier && amount * 10000n > base * 2000n)
        throw new DiscountLimitError("Cashier manual limit is 20%");
      manualTotal += amount;
      explanations.push({
        productId: l.productId,
        source: "manual",
        type: request.discount.type,
        value: request.discount.value.toString(),
      });
    } else {
      const candidates = promotions
        .filter((p) => p.productId?.toLowerCase() === l.productId)
        .map((p) => ({
          rule: p,
          amount:
            p.discount.type === "amount"
              ? calculateSaleLineTotal(money(p.discount.value), l.quantity)
                  .minorUnits
              : discountAmount(base, p.discount, true),
        }))
        .map((p) => ({ ...p, amount: p.amount > base ? base : p.amount }))
        .sort((a, b) =>
          a.amount === b.amount
            ? a.rule.id.localeCompare(b.rule.id)
            : a.amount > b.amount
              ? -1
              : 1,
        );
      const picked = candidates[0];
      if (picked) {
        amount = picked.amount > base ? base : picked.amount;
        explanations.push({
          productId: l.productId,
          source: "promotion",
          type: picked.rule.discount.type,
          value: picked.rule.discount.value.toString(),
          promotionId: picked.rule.id,
          promotionName: picked.rule.name ?? "Promoción",
        });
      }
    }
    if (!explanations.some((e) => e.productId === l.productId))
      explanations.push({
        productId: l.productId,
        source: "none",
        type: "amount",
        value: "0",
      });
    return { productId: l.productId, base, paid: base - amount };
  });
  const subtotal = values.reduce((s, l) => s + l.paid, 0n);
  const saleAmount = intent.sale ? discountAmount(subtotal, intent.sale) : 0n;
  if (
    cashier &&
    (saleAmount * 10000n > subtotal * 2000n ||
      (manualTotal + saleAmount) * 10000n > original.total.minorUnits * 2000n)
  )
    throw new DiscountLimitError("Cashier combined manual limit is 20%");
  const saleAllocation = allocate(saleAmount, values);
  const afterSale = values.map((l, i) => ({
    ...l,
    paid: l.paid - (saleAllocation[i] ?? 0n),
  }));
  const couponAmount = coupon
    ? discountAmount(subtotal - saleAmount, coupon.discount, true)
    : 0n;
  const couponAllocation = allocate(couponAmount, afterSale);
  const hasDetails =
    explanations.some((e) => e.source !== "none") ||
    intent.sale !== undefined ||
    coupon !== undefined;
  const paidLines = original.lines.map((l, i) => {
    const paid = (afterSale[i]?.paid ?? 0n) - (couponAllocation[i] ?? 0n);
    const reduction = l.lineTotal.minorUnits - paid;
    return Object.freeze({
      ...l,
      ...(hasDetails ? { discount: money(reduction) } : {}),
      lineTotal: money(paid),
    });
  });
  const sale = completeSale({
    ...draft,
    lines: paidLines,
    total: money(subtotal - saleAmount - couponAmount),
  });
  if (!hasDetails) return Object.freeze({ sale });
  const details: DiscountDetails = Object.freeze({
    lineDiscountTotal: (original.total.minorUnits - subtotal).toString(),
    saleDiscountTotal: saleAmount.toString(),
    couponDiscountTotal: couponAmount.toString(),
    ...(intent.sale
      ? {
          manualSale: Object.freeze({
            type: intent.sale.type,
            value: intent.sale.value.toString(),
          }),
        }
      : {}),
    ...(coupon
      ? {
          coupon: Object.freeze({
            id: coupon.id,
            code: coupon.code ?? "",
            type: coupon.discount.type,
            value: coupon.discount.value.toString(),
          }),
        }
      : {}),
    lines: Object.freeze(
      explanations.map((l, i) =>
        Object.freeze({
          ...l,
          lineDiscount: (
            (values[i]?.base ?? 0n) - (values[i]?.paid ?? 0n)
          ).toString(),
          saleAllocation: (saleAllocation[i] ?? 0n).toString(),
          couponAllocation: (couponAllocation[i] ?? 0n).toString(),
        }),
      ),
    ),
  });
  return Object.freeze({ sale, details });
}

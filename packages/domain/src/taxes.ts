import { productId } from "./product-fields";
import { money } from "./money";
import { completeSale, type CompletedSale } from "./sale";

import { taxRate, taxAmount, type TaxRule } from "./tax-rate";
export * from "./tax-rate";
/** All line/sale/coupon reductions have already been allocated to commercial
 * bases. Tax is exclusive, HALF-UP per discounted line; never tax a discount. */
export function applySaleTaxes(
  sale: CompletedSale,
  rules: readonly TaxRule[],
): CompletedSale {
  const ids = rules.map((r) => productId(r.productId).toLowerCase());
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !sale.lines.some((l) => l.productId === id))
  )
    throw new TypeError("Invalid tax mapping");
  const lines = sale.lines.map((line) => {
    if (line.tax !== undefined) throw new TypeError("Already taxed sale");
    const rule = rules.find(
      (r) => productId(r.productId).toLowerCase() === line.productId,
    );
    if (!rule) return line;
    const rate = taxRate(rule.rate);
    if (
      typeof rule.name !== "string" ||
      !rule.name.trim() ||
      rule.name.length > 120
    )
      throw new TypeError("Invalid tax name");
    const base = money(line.lineTotal.minorUnits);
    const tax = Object.freeze({
      profileId: productId(rule.profileId).toLowerCase(),
      name: rule.name,
      rate,
      base,
      amount: taxAmount(base, rate),
    });
    return Object.freeze({
      ...line,
      tax,
      lineTotal: money(base.minorUnits + tax.amount.minorUnits),
    });
  });
  return completeSale({
    ...sale,
    status: "draft",
    lines,
    total: money(lines.reduce((sum, l) => sum + l.lineTotal.minorUnits, 0n)),
  });
}

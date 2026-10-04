import { money, addMoney, compareMoney, type Money } from "./money";
import { quantity, addQuantity, type Quantity } from "./quantity";
import { createProduct, type Product } from "./product";
import {
  productId,
  productName,
  sku,
  type ProductId,
  type ProductName,
  type Sku,
} from "./product-fields";
import { customerId } from "./customer";
import { assertUnitCode, type UnitCode } from "./unit";

declare const saleIdBrand: unique symbol;
export type SaleId = string & { readonly [saleIdBrand]: true };

export function saleId(value: string): SaleId {
  // Reuse the existing pure UUID primitive; identifiers are case-insensitive.
  return productId(value).toLowerCase() as SaleId;
}

export type SaleLine = Readonly<{
  productId: ProductId;
  sku: Sku;
  name: ProductName;
  unit: UnitCode;
  quantity: Quantity;
  unitPrice: Money;
  lineTotal: Money;
  discount?: Money;
}>;
type SaleValues = Readonly<{
  id: SaleId;
  customerId?: string;
  lines: readonly SaleLine[];
  total: Money;
}>;
export type SaleDraft = SaleValues & Readonly<{ status: "draft" }>;
/** Domain closure only: does not mean paid, persisted or stock deducted. */
export type CompletedSale = SaleValues & Readonly<{ status: "completed" }>;
export type Sale = SaleDraft | CompletedSale;

function positiveQuantity(value: Quantity): Quantity {
  if (!value) throw new TypeError("Expected sale quantity");
  const copy = quantity(value.unit, value.milliUnits);
  if (copy.milliUnits <= 0n)
    throw new TypeError("Sale quantity must be positive");
  return copy;
}

function nonnegativePrice(value: Money): Money {
  const copy = addMoney(value, money(0n));
  if (copy.minorUnits < 0n)
    throw new TypeError("Sale price must be nonnegative");
  return copy;
}

/** HALF-UP to MXN cents per line, for nonnegative prices/positive quantities. */
export function calculateSaleLineTotal(price: Money, amount: Quantity): Money {
  const validPrice = nonnegativePrice(price);
  const validAmount = positiveQuantity(amount);
  return money((validPrice.minorUnits * validAmount.milliUnits + 500n) / 1000n);
}

function snapshotLine(value: SaleLine): SaleLine {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Expected sale line");
  const id = productId(productId(value.productId).toLowerCase());
  const name = productName(value.name);
  const code = sku(value.sku);
  assertUnitCode(value.unit);
  const amount = positiveQuantity(value.quantity);
  if (amount.unit !== value.unit)
    throw new TypeError("Sale line unit mismatch");
  const price = nonnegativePrice(value.unitPrice);
  const base = calculateSaleLineTotal(price, amount);
  const reduction =
    value.discount === undefined ? undefined : nonnegativePrice(value.discount);
  if (reduction && reduction.minorUnits > base.minorUnits)
    throw new TypeError("Discount exceeds line");
  const total = money(base.minorUnits - (reduction?.minorUnits ?? 0n));
  if (compareMoney(total, value.lineTotal) !== 0)
    throw new TypeError("Inconsistent sale line total");
  return Object.freeze({
    productId: id,
    sku: code,
    name,
    unit: value.unit,
    quantity: amount,
    unitPrice: price,
    lineTotal: total,
    ...(reduction === undefined ? {} : { discount: reduction }),
  });
}

function buildSale(
  id: SaleId,
  lines: readonly SaleLine[],
  status: "draft",
  customer?: string,
): SaleDraft;
function buildSale(
  id: SaleId,
  lines: readonly SaleLine[],
  status: "completed",
  customer?: string,
): CompletedSale;
function buildSale(
  id: SaleId,
  lines: readonly SaleLine[],
  status: Sale["status"],
  customer?: string,
): Sale;
function buildSale(
  id: SaleId,
  lines: readonly SaleLine[],
  status: Sale["status"],
  customer?: string,
): Sale {
  const copies: SaleLine[] = [];
  const ids = new Set<string>();
  let total = money(0n);
  for (const line of lines) {
    const copy = snapshotLine(line);
    if (ids.has(copy.productId)) throw new TypeError("Duplicate sale product");
    ids.add(copy.productId);
    copies.push(copy);
    total = addMoney(total, copy.lineTotal);
  }
  if (status === "completed" && copies.length === 0)
    throw new TypeError("Cannot complete an empty sale");
  return Object.freeze({
    id: saleId(id),
    ...(customer === undefined ? {} : { customerId: customerId(customer) }),
    lines: Object.freeze(copies),
    total,
    status,
  });
}

function mutableDraft(value: Sale): SaleDraft {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray(value.lines) ||
    (value.status !== "draft" && value.status !== "completed")
  )
    throw new TypeError("Expected sale");
  const copy = buildSale(value.id, value.lines, value.status, value.customerId);
  if (compareMoney(copy.total, value.total) !== 0)
    throw new TypeError("Inconsistent sale total");
  if (copy.status !== "draft")
    throw new TypeError("Completed sale is immutable");
  return copy;
}

export function createSaleDraft(id: string, customer?: string): SaleDraft {
  return buildSale(saleId(id), [], "draft", customer);
}

export function addSaleProduct(
  sale: Sale,
  product: Product,
  amount: Quantity,
): SaleDraft {
  const draft = mutableDraft(sale);
  const current = createProduct(product);
  if (current.status !== "active")
    throw new TypeError("Inactive product cannot be added");
  const added = positiveQuantity(amount);
  if (added.unit !== current.unit)
    throw new TypeError("Product quantity unit mismatch");
  const id = productId(current.id.toLowerCase());
  const existing = draft.lines.find((line) => line.productId === id);
  let lines: readonly SaleLine[];
  if (existing) {
    // Preserve the original snapshot even if Product configuration has changed.
    const combined = addQuantity(existing.quantity, added);
    const replacement = Object.freeze({
      ...existing,
      quantity: combined,
      lineTotal: calculateSaleLineTotal(existing.unitPrice, combined),
    });
    lines = draft.lines.map((line) =>
      line.productId === id ? replacement : line,
    );
  } else {
    const price = nonnegativePrice(current.salePrice);
    lines = [
      ...draft.lines,
      {
        productId: id,
        sku: current.sku,
        name: current.name,
        unit: current.unit,
        quantity: added,
        unitPrice: price,
        lineTotal: calculateSaleLineTotal(price, added),
      },
    ];
  }
  return buildSale(draft.id, lines, "draft", draft.customerId);
}

export function changeSaleQuantity(
  sale: Sale,
  id: string,
  amount: Quantity,
): SaleDraft {
  const draft = mutableDraft(sale);
  const target = productId(id).toLowerCase();
  const existing = draft.lines.find((line) => line.productId === target);
  if (!existing) throw new TypeError("Sale line not found");
  const updated = positiveQuantity(amount);
  if (updated.unit !== existing.unit)
    throw new TypeError("Sale line unit mismatch");
  return buildSale(
    draft.id,
    draft.lines.map((line) =>
      line.productId === target
        ? {
            ...line,
            quantity: updated,
            lineTotal: calculateSaleLineTotal(line.unitPrice, updated),
          }
        : line,
    ),
    "draft",
    draft.customerId,
  );
}

export function removeSaleLine(sale: Sale, id: string): SaleDraft {
  const draft = mutableDraft(sale);
  const target = productId(id).toLowerCase();
  if (!draft.lines.some((line) => line.productId === target))
    throw new TypeError("Sale line not found");
  return buildSale(
    draft.id,
    draft.lines.filter((line) => line.productId !== target),
    "draft",
    draft.customerId,
  );
}

export function completeSale(sale: Sale): CompletedSale {
  const draft = mutableDraft(sale);
  return buildSale(draft.id, draft.lines, "completed", draft.customerId);
}

export function assignSaleCustomer(sale: Sale, customer?: string): SaleDraft {
  const draft = mutableDraft(sale);
  return buildSale(draft.id, draft.lines, "draft", customer);
}

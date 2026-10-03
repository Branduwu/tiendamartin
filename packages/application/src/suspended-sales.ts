import {
  inventoryLocationId,
  productId,
  quantity,
  saleId,
  createSaleDraft,
  addSaleProduct,
  type Quantity,
  type Product,
  type SaleDraft,
} from "@smartretail/domain";

export type SuspensionInput = Readonly<{
  id: string;
  locationId: string;
  lines: readonly Readonly<{ productId: string; quantity: Quantity }>[];
}>;
export type SuspendedSale = SuspensionInput &
  Readonly<{
    tenantId: string;
    createdBy: string;
    createdAt: string;
    status: "suspended" | "completed" | "cancelled";
  }>;
export class SuspensionConflictError extends Error {}
export class SuspensionNotFoundError extends Error {}

/** Canonical retry content contains quantities and units, never prices/payments. */
export function suspensionCommand(input: SuspensionInput) {
  if (
    !input ||
    !Array.isArray(input.lines) ||
    input.lines.length < 1 ||
    input.lines.length > 1000
  )
    throw new TypeError("Invalid suspended cart");
  const lines = input.lines
    .map((l) => {
      const q = quantity(l.quantity.unit, l.quantity.milliUnits);
      if (
        q.milliUnits <= 0n ||
        (q.unit === "piece" && q.milliUnits % 1000n !== 0n)
      )
        throw new TypeError("Positive quantity required");
      return Object.freeze({
        productId: productId(l.productId).toLowerCase(),
        quantity: q,
      });
    })
    .sort((a, b) => a.productId.localeCompare(b.productId));
  if (new Set(lines.map((l) => l.productId)).size !== lines.length)
    throw new TypeError("Duplicate product");
  const snapshot = Object.freeze({
    id: saleId(input.id),
    locationId: inventoryLocationId(input.locationId).toLowerCase(),
    lines: Object.freeze(lines),
  });
  const payload = JSON.stringify({
    ...snapshot,
    lines: lines.map((l) => ({
      productId: l.productId,
      unit: l.quantity.unit,
      quantity: l.quantity.milliUnits.toString(),
    })),
  });
  return { snapshot, payload };
}

/** Rebuild only from current server Products. Unit changes require explicit review
 * rather than silently reinterpreting an old measurement. Stored cart survives. */
export function rebuildSuspendedSale(
  record: SuspendedSale,
  products: readonly Product[],
  newSaleId: string,
): SaleDraft {
  if (record.status !== "suspended") throw new SuspensionConflictError();
  let draft = createSaleDraft(newSaleId);
  for (const line of record.lines) {
    const product = products.find((p) => p.id === line.productId);
    if (
      !product ||
      product.status !== "active" ||
      product.unit !== line.quantity.unit
    )
      throw new SuspensionConflictError("Product unavailable or unit changed");
    draft = addSaleProduct(draft, product, line.quantity);
  }
  return draft;
}

/** Keyboard scans of fractional units cannot invent a quantity. */
export function scanSaleProduct(
  draft: SaleDraft,
  product: Product,
  explicit?: Quantity,
): SaleDraft {
  if (product.unit !== "piece" && explicit === undefined)
    throw new TypeError("Explicit quantity required");
  return addSaleProduct(draft, product, explicit ?? quantity("piece", 1000n));
}

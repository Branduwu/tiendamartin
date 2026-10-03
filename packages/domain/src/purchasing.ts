import { productId, type ProductId } from "./product-fields";
import { quantity, type Quantity } from "./quantity";
import { money, type Money } from "./money";

export class PurchaseConflictError extends Error {}
export type SupplierFields = Readonly<{
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  notes?: string;
  status: "active" | "inactive";
}>;
export type Supplier = SupplierFields &
  Readonly<{
    id: string;
    tenantId: string;
    createdAt: string;
  }>;
export type SupplierChanges = Partial<
  Pick<SupplierFields, "name" | "status">
> & {
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
};
export function supplierFields(input: SupplierFields): SupplierFields {
  if (!input || typeof input !== "object")
    throw new TypeError("Invalid supplier");
  const clean = (value: string, max: number) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > max ||
      Array.from(value).some(
        (char) =>
          char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)),
      )
    )
      throw new TypeError("Invalid supplier field");
    return value.trim();
  };
  if (!["active", "inactive"].includes(input.status))
    throw new TypeError("Invalid supplier status");
  return Object.freeze({
    name: clean(input.name, 200),
    status: input.status,
    ...(input.contactName === undefined
      ? {}
      : { contactName: clean(input.contactName, 200) }),
    ...(input.phone === undefined ? {} : { phone: clean(input.phone, 50) }),
    ...(input.email === undefined ? {} : { email: clean(input.email, 254) }),
    ...(input.notes === undefined ? {} : { notes: clean(input.notes, 2000) }),
  });
}
export type PurchaseLineInput = Readonly<{
  productId: ProductId;
  quantityOrdered: Quantity;
  unitCost: Money;
}>;
export type PurchaseLine = PurchaseLineInput &
  Readonly<{ quantityReceived: Quantity }>;
export type PurchaseStatus =
  "draft" | "ordered" | "partially_received" | "received" | "cancelled";
export type PurchaseDraftInput = Readonly<{
  id: string;
  supplierId: string;
  locationId: string;
  notes?: string;
  lines: readonly PurchaseLineInput[];
}>;
export type PurchaseOrder = Omit<PurchaseDraftInput, "lines"> &
  Readonly<{
    tenantId: string;
    status: PurchaseStatus;
    createdBy: string;
    createdAt: string;
    orderedAt?: string;
    lines: readonly PurchaseLine[];
  }>;
export type PurchaseReceiptInput = Readonly<{
  id: string;
  lines: readonly Readonly<{ productId: ProductId; quantity: Quantity }>[];
}>;
/** Technical command bound; not a commercial limit on stock or money. */
export function purchaseDraft(input: PurchaseDraftInput): PurchaseDraftInput {
  const validId = (id: string) => productId(id).toLowerCase();
  if (
    !input ||
    !Array.isArray(input.lines) ||
    input.lines.length < 1 ||
    input.lines.length > 50
  )
    throw new TypeError("Expected 1–50 purchase lines");
  if (
    input.notes !== undefined &&
    (typeof input.notes !== "string" || input.notes.length > 2000)
  )
    throw new TypeError("Invalid purchase notes");
  const seen = new Set<string>();
  const lines = input.lines.map((l) => {
    const id = productId(validId(l.productId));
    if (seen.has(id)) throw new TypeError("Duplicate purchase product");
    seen.add(id);
    const q = quantity(l.quantityOrdered.unit, l.quantityOrdered.milliUnits);
    if (
      q.milliUnits <= 0n ||
      (q.unit === "piece" && q.milliUnits % 1000n !== 0n)
    )
      throw new TypeError("Invalid purchase quantity");
    if (
      l.unitCost.currency !== "MXN" ||
      typeof l.unitCost.minorUnits !== "bigint" ||
      l.unitCost.minorUnits < 0n
    )
      throw new TypeError("Invalid purchase cost");
    return Object.freeze({
      productId: id,
      quantityOrdered: q,
      unitCost: money(l.unitCost.minorUnits),
    });
  });
  return Object.freeze({
    id: validId(input.id),
    supplierId: validId(input.supplierId),
    locationId: validId(input.locationId),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    lines: Object.freeze(lines),
  });
}
export function purchaseReceipt(
  input: PurchaseReceiptInput,
): PurchaseReceiptInput {
  if (
    !input ||
    !Array.isArray(input.lines) ||
    input.lines.length < 1 ||
    input.lines.length > 50
  )
    throw new TypeError("Invalid receipt lines");
  const seen = new Set<string>();
  const lines = input.lines
    .map((l) => {
      const id = productId(l.productId.toLowerCase());
      if (seen.has(id)) throw new TypeError("Duplicate receipt product");
      seen.add(id);
      const q = quantity(l.quantity.unit, l.quantity.milliUnits);
      if (
        q.milliUnits <= 0n ||
        (q.unit === "piece" && q.milliUnits % 1000n !== 0n)
      )
        throw new TypeError("Invalid receipt quantity");
      return Object.freeze({ productId: id, quantity: q });
    })
    .sort((a, b) => a.productId.localeCompare(b.productId));
  return Object.freeze({
    id: productId(input.id).toLowerCase(),
    lines: Object.freeze(lines),
  });
}
export function receivePurchase(
  order: PurchaseOrder,
  input: PurchaseReceiptInput,
): PurchaseOrder {
  const receipt = purchaseReceipt(input);
  if (order.status !== "ordered" && order.status !== "partially_received")
    throw new PurchaseConflictError("Purchase cannot receive");
  for (const l of receipt.lines)
    if (!order.lines.some((o) => o.productId === l.productId))
      throw new PurchaseConflictError("Product not ordered");
  const lines = order.lines.map((l) => {
    const incoming = receipt.lines.find(
      (r) => r.productId === l.productId,
    )?.quantity;
    if (!incoming) return l;
    if (
      incoming.unit !== l.quantityOrdered.unit ||
      incoming.milliUnits >
        l.quantityOrdered.milliUnits - l.quantityReceived.milliUnits
    )
      throw new PurchaseConflictError("Receipt exceeds remaining quantity");
    return Object.freeze({
      ...l,
      quantityReceived: quantity(
        incoming.unit,
        l.quantityReceived.milliUnits + incoming.milliUnits,
      ),
    });
  });
  return Object.freeze({
    ...order,
    lines: Object.freeze(lines),
    status: lines.every(
      (l) => l.quantityReceived.milliUnits === l.quantityOrdered.milliUnits,
    )
      ? "received"
      : "partially_received",
  });
}

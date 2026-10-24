import type { PurchaseOrderDto, SupplierDto } from "@smartretail/contracts";
import { documentIdentity } from "./document-review";
import { minorUnitsToDecimal } from "./money-input";

export const purchaseStatusText: Record<PurchaseOrderDto["status"], string> = {
  draft: "Borrador",
  ordered: "Pendiente de recibir",
  partially_received: "Recibida parcialmente",
  received: "Recibida",
  cancelled: "Cancelada",
};
export type PurchaseFilters = {
  query: string;
  supplier: string;
  status: string;
  from: string;
  to: string;
};
export const emptyPurchaseFilters: PurchaseFilters = {
  query: "",
  supplier: "",
  status: "",
  from: "",
  to: "",
};
const normalize = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX");
/** Same business timezone as formatDateTime. No UTC/local date mixing. */
export function purchaseDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function purchaseReference(order: PurchaseOrderDto): string {
  return (
    documentIdentity(order.notes)?.reference ||
    `OC-${order.id.slice(0, 8).toUpperCase()}`
  );
}
export function filterPurchases(
  orders: readonly PurchaseOrderDto[],
  suppliers: readonly SupplierDto[],
  filters: PurchaseFilters,
): PurchaseOrderDto[] {
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const terms = normalize(filters.query.trim()).split(/\s+/).filter(Boolean);
  return orders.filter((o) => {
    if (filters.supplier && o.supplierId !== filters.supplier) return false;
    if (filters.status && o.status !== filters.status) return false;
    const date = purchaseDate(o.createdAt);
    if (
      (filters.from && date < filters.from) ||
      (filters.to && date > filters.to)
    )
      return false;
    const text = normalize(
      `${names.get(o.supplierId) ?? ""} ${purchaseReference(o)} ${o.id} ${o.notes ?? ""}`,
    );
    return terms.every((term) => text.includes(term));
  });
}
/** Display only: identical HALF-UP per line to 020_payables_expenses.sql.
 * This is the ordered amount, never an outstanding/payable or received total. */
export function purchaseLineAmount(
  line: PurchaseOrderDto["lines"][number],
): bigint {
  return (
    (BigInt(line.quantityOrdered.milliUnits) *
      BigInt(line.unitCost.minorUnits) +
      500n) /
    1000n
  );
}
export function purchaseAmount(order: PurchaseOrderDto): string {
  return minorUnitsToDecimal(
    order.lines
      .reduce((sum, line) => sum + purchaseLineAmount(line), 0n)
      .toString(),
  );
}

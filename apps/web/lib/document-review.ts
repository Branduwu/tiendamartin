import {
  CreatePurchaseOrderSchema,
  UuidSchema,
  type ProductDto,
  type PurchaseOrderDto,
} from "@smartretail/contracts";
import { decimalToMinorUnits } from "./money-input";
import { decimalToMilliUnits } from "./quantity-input";
import {
  detectedAmount,
  type ProposedValue,
  type DocumentProposal,
  type DocumentLine,
} from "./document-proposal";
export function reviewedAmount(raw: string, quantity = false): ProposedValue {
  try {
    return {
      raw,
      value: quantity ? decimalToMilliUnits(raw) : decimalToMinorUnits(raw),
      state: "Detectado",
    };
  } catch {
    return { raw, value: null, state: raw ? "Revisar" : "No identificado" };
  }
}
export type ReviewLine = {
  proposal: DocumentLine;
  productId: string;
  unit: string;
  quantity: string;
  cost: string;
  confirmed: boolean;
  ignored: boolean;
};
export class DocumentReviewError extends Error {
  constructor(
    message: string,
    readonly fieldId: string,
  ) {
    super(message);
  }
}
export type DocumentIdentity = {
  reference: string;
  date: string;
  total: string;
};
export function documentIdentity(
  notes: string | undefined,
): DocumentIdentity | null {
  if (!notes?.startsWith("Documento revisado: ")) return null;
  try {
    const result: unknown = JSON.parse(
      notes.slice("Documento revisado: ".length),
    );
    if (
      !result ||
      typeof result !== "object" ||
      !("reference" in result) ||
      !("date" in result) ||
      !("total" in result) ||
      typeof result.reference !== "string" ||
      typeof result.date !== "string" ||
      typeof result.total !== "string"
    )
      return null;
    return {
      reference: result.reference,
      date: result.date,
      total: result.total,
    };
  } catch {
    return null;
  }
}
export function possibleDuplicate(
  orders: readonly PurchaseOrderDto[],
  supplierId: string,
  identity: DocumentIdentity,
): boolean {
  if (!supplierId || !identity.reference || !identity.date || !identity.total)
    return false;
  return orders.some((order) => {
    const existing = documentIdentity(order.notes);
    return (
      order.supplierId === supplierId &&
      existing?.reference === identity.reference &&
      existing.date === identity.date &&
      existing.total === identity.total
    );
  });
}
export function reviewedDraft(
  id: string,
  supplierId: string,
  locationId: string,
  proposal: DocumentProposal,
  lines: readonly ReviewLine[],
  products: readonly ProductDto[],
) {
  if (!UuidSchema.safeParse(supplierId).success)
    throw new DocumentReviewError("Selecciona un proveedor.", "doc-supplier");
  if (!UuidSchema.safeParse(locationId).success)
    throw new DocumentReviewError("Selecciona una sucursal.", "doc-location");
  if (proposal.currency !== "MXN")
    throw new DocumentReviewError(
      "Confirma que la moneda del documento es MXN.",
      "doc-currency",
    );
  const total = detectedAmount(proposal.total.raw),
    subtotal = detectedAmount(proposal.subtotal.raw),
    tax = detectedAmount(proposal.tax.raw);
  const notes =
    "Documento revisado: " +
    JSON.stringify({
      reference: proposal.reference,
      date: proposal.date,
      total: total.value ?? "",
      subtotal: subtotal.value ?? "",
      tax: tax.value ?? "",
      currency: "MXN",
      taxTreatment:
        "Datos del documento; los costos del borrador se confirman por línea.",
    });
  const included = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !line.ignored);
  if (!included.length)
    throw new DocumentReviewError(
      "Incluye al menos una línea de compra.",
      "doc-lines",
    );
  const selected = new Set<string>();
  return CreatePurchaseOrderSchema.parse({
    id,
    supplierId,
    locationId,
    notes,
    lines: included.map(({ line, index }) => {
      const product = products.find(
        (p) => p.id === line.productId && p.status === "active",
      );
      if (!product || !line.confirmed)
        throw new DocumentReviewError(
          `Línea ${index + 1}: confirma el producto o ignora la línea.`,
          `doc-product-${index}`,
        );
      if (selected.has(product.id))
        throw new DocumentReviewError(
          `Línea ${index + 1}: este producto ya está incluido; combina las cantidades manualmente.`,
          `doc-product-${index}`,
        );
      selected.add(product.id);
      if (!line.unit || line.unit !== product.unit)
        throw new DocumentReviewError(
          "Revisa la unidad: debe coincidir con la del producto.",
          `doc-unit-${index}`,
        );
      const q = reviewedAmount(line.quantity, true),
        cost = reviewedAmount(line.cost);
      if (
        q.value === null ||
        BigInt(q.value) <= 0n ||
        (line.unit === "piece" && BigInt(q.value) % 1000n !== 0n)
      )
        throw new DocumentReviewError(
          `Línea ${index + 1}: usa cantidad positiva y piezas enteras.`,
          `doc-quantity-${index}`,
        );
      if (cost.value === null)
        throw new DocumentReviewError(
          `Línea ${index + 1}: usa un costo no negativo con hasta dos decimales.`,
          `doc-cost-${index}`,
        );
      return {
        productId: product.id,
        quantityOrdered: {
          unit: product.unit,
          milliUnits: q.value,
        },
        unitCost: {
          currency: "MXN",
          minorUnits: cost.value,
        },
      };
    }),
  });
}

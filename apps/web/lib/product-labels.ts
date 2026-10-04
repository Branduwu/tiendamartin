import type { ProductDto } from "@smartretail/contracts";
import { UuidSchema } from "@smartretail/contracts";
import { minorUnitsToDecimal } from "./money-input";

export type LabelSize = "small" | "standard";
export function labelQuery(
  query: Record<string, string | string[] | undefined>,
): {
  tenantId?: string;
  productId?: string;
  error?: string;
} {
  const invalid = {
    error:
      "El enlace de etiquetas no es válido. Abre Etiquetas desde el producto.",
  };
  if (Object.keys(query).some((k) => !["tenantId", "productId"].includes(k)))
    return invalid;
  for (const value of Object.values(query))
    if (value !== undefined && !UuidSchema.safeParse(value).success)
      return invalid;
  if (query.productId && !query.tenantId) return invalid;
  return {
    ...(typeof query.tenantId === "string" ? { tenantId: query.tenantId } : {}),
    ...(typeof query.productId === "string"
      ? { productId: query.productId }
      : {}),
  };
}
/** Counts are bounded integers; they are never inventory quantities or money. */
export function labelQuantity(text: string): number {
  if (!/^(?:[1-9]\d?|100)(?![\s\S])/.test(text))
    throw new RangeError("Usa entre 1 y 100 etiquetas por producto.");
  return Number(text);
}
export function labelItems(
  products: readonly ProductDto[],
  selections: readonly { productId: string; quantity: number }[],
) {
  const seen = new Set<string>();
  let count = 0;
  return selections.flatMap((selection) => {
    if (
      !Number.isInteger(selection.quantity) ||
      selection.quantity < 1 ||
      selection.quantity > 100
    )
      throw new RangeError("Cantidad de etiquetas inválida.");
    if (seen.has(selection.productId))
      throw new TypeError("Producto duplicado.");
    seen.add(selection.productId);
    count += selection.quantity;
    if (count > 200)
      throw new RangeError("Prepara hasta 200 etiquetas por impresión.");
    const product = products.find((p) => p.id === selection.productId);
    if (!product)
      throw new TypeError("Producto no disponible en esta empresa.");
    return Array.from({ length: selection.quantity }, (_, i) => ({
      product,
      copy: i + 1,
    }));
  });
}
export const formatLabelPrice = (minorUnits: string) =>
  `$${minorUnitsToDecimal(minorUnits)} MXN`;

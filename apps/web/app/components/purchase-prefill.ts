import {
  QuantitySchema,
  UuidSchema,
  type ProductDto,
  type InventoryLocationDto,
} from "@smartretail/contracts";
import { milliUnitsToDecimal } from "../../lib/quantity-input";

export type PurchasePrefill = {
  productId: string;
  locationId: string;
  amount: string;
};
export type ReplenishmentRequest = {
  tenantId: string;
  productId: string;
  locationId: string;
};
export function replenishmentPath(request: ReplenishmentRequest) {
  return `/api/v1/inventory/replenishment?${new URLSearchParams({ productId: request.productId, locationId: request.locationId })}`;
}
/** Only a fresh API response can provide the quantity; URL quantities are ignored. */
export function trustedPurchasePrefill(
  value: unknown,
  request: ReplenishmentRequest,
  products: ProductDto[],
  locations: InventoryLocationDto[],
): PurchasePrefill {
  if (
    !value ||
    typeof value !== "object" ||
    !("tenantId" in value) ||
    !("productId" in value) ||
    !("locationId" in value) ||
    !("quantityOrdered" in value)
  )
    throw new Error("Sugerencia de compra inválida.");
  for (const field of ["tenantId", "productId", "locationId"] as const) {
    if (
      !UuidSchema.safeParse(value[field]).success ||
      value[field] !== request[field]
    )
      throw new Error(
        "La sugerencia no corresponde a la empresa, producto o ubicación solicitados.",
      );
  }
  const quantity = QuantitySchema.parse(value.quantityOrdered);
  const product = products.find(
    (p) => p.id === request.productId && p.status === "active",
  );
  const location = locations.find(
    (l) => l.id === request.locationId && l.status === "active",
  );
  if (!product || !location || product.unit !== quantity.unit)
    throw new Error(
      "Producto, unidad o ubicación no disponibles para esta compra.",
    );
  const amount = BigInt(quantity.milliUnits);
  if (amount <= 0n)
    throw new Error("Ya no hay faltante sugerido. Actualiza las alertas.");
  if (
    amount > 9223372036854775807n ||
    (quantity.unit === "piece" && amount % 1000n !== 0n)
  )
    throw new Error("Cantidad sugerida inválida.");
  return {
    productId: request.productId,
    locationId: request.locationId,
    amount: milliUnitsToDecimal(quantity.milliUnits),
  };
}

import {
  createSaleDraft,
  addSaleProduct,
  changeSaleQuantity,
  removeSaleLine,
  completeSale,
  type Product,
  type Quantity,
  type Sale,
} from "@smartretail/domain";

/** Local draft orchestration only; no persistence, payment or authorization API. */
export function startSale(id: string) {
  return createSaleDraft(id);
}

export type SaleCommand =
  | Readonly<{ type: "add-product"; product: Product; quantity: Quantity }>
  | Readonly<{ type: "change-quantity"; productId: string; quantity: Quantity }>
  | Readonly<{ type: "remove-line"; productId: string }>
  | Readonly<{ type: "complete" }>;

export function executeSaleCommand(sale: Sale, command: SaleCommand): Sale {
  if (!command || typeof command !== "object")
    throw new TypeError("Expected sale command");
  switch (command.type) {
    case "add-product":
      return addSaleProduct(sale, command.product, command.quantity);
    case "change-quantity":
      return changeSaleQuantity(sale, command.productId, command.quantity);
    case "remove-line":
      return removeSaleLine(sale, command.productId);
    case "complete":
      return completeSale(sale);
    default:
      throw new TypeError("Unknown sale command");
  }
}

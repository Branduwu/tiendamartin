import {
  purchaseReceipt,
  purchaseDraft,
  supplierFields,
  productId,
  type Supplier,
  type SupplierFields,
  type SupplierChanges,
  type PurchaseOrder,
  type PurchaseDraftInput,
  type PurchaseReceiptInput,
} from "@smartretail/domain";
export class PurchasingNotFoundError extends Error {}
export interface PurchasingRepository {
  listSuppliers(): Promise<readonly Supplier[]>;
  createSupplier(id: string, fields: SupplierFields): Promise<Supplier>;
  updateSupplier(id: string, changes: SupplierChanges): Promise<Supplier>;
  listPurchases(): Promise<readonly PurchaseOrder[]>;
  readPurchase(id: string): Promise<PurchaseOrder>;
  createPurchase(input: PurchaseDraftInput): Promise<PurchaseOrder>;
  updatePurchase(input: PurchaseDraftInput): Promise<PurchaseOrder>;
  changePurchase(
    id: string,
    action: "order" | "cancel",
  ): Promise<PurchaseOrder>;
  receivePurchaseOrder(
    id: string,
    input: PurchaseReceiptInput,
  ): Promise<{ order: PurchaseOrder; replayed: boolean }>;
}
export function receivePurchaseOrder(
  repo: PurchasingRepository,
  id: string,
  input: PurchaseReceiptInput,
) {
  return repo.receivePurchaseOrder(
    productId(id).toLowerCase(),
    purchaseReceipt(input),
  );
}
export function createPurchaseOrder(
  repo: PurchasingRepository,
  input: PurchaseDraftInput,
) {
  return repo.createPurchase(purchaseDraft(input));
}
export function createSupplier(
  repo: PurchasingRepository,
  id: string,
  input: SupplierFields,
) {
  return repo.createSupplier(
    productId(id).toLowerCase(),
    supplierFields(input),
  );
}

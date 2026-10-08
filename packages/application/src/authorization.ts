import { productId } from "@smartretail/domain";

/** Identity must originate from a verified external subject, not a client DTO. */
export type AuthenticatedContext = Readonly<{
  userId: string;
  tenantId: string;
}>;
export type Permission =
  | "sales.discount"
  | "promotions.read"
  | "promotions.write"
  | "taxes.manage"
  | "credit.manage"
  | "receivables.read"
  | "receivables.pay"
  | "inventory.minimum.write"
  | "reports.read"
  | "customers.read"
  | "customers.write"
  | "suppliers.read"
  | "suppliers.write"
  | "purchases.read"
  | "purchases.write"
  | "purchases.receive"
  | "products.read"
  | "products.write"
  | "locations.read"
  | "locations.write"
  | "inventory.read"
  | "inventory.receive"
  | "inventory.issue"
  | "inventory.adjust"
  | "inventory.transfer"
  | "members.manage"
  | "sales.read"
  | "sales.create"
  | "sales.return"
  | "payables.read"
  | "payables.pay"
  | "expenses.read"
  | "expenses.write"
  | "cash.read"
  | "cash.open"
  | "cash.move"
  | "cash.close";

/** Validates UUID syntax and snapshots context; does not authenticate a token. */
export function authenticatedContext(
  input: AuthenticatedContext,
): AuthenticatedContext {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Invalid authenticated context");
  return Object.freeze({
    userId: productId(input.userId).toLowerCase(),
    tenantId: productId(input.tenantId).toLowerCase(),
  });
}

export class PermissionDeniedError extends Error {
  constructor() {
    super("Permission denied");
    this.name = "PermissionDeniedError";
  }
}

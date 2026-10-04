import { productId } from "./product-fields";
import { money, type Money } from "./money";
export type CustomerFields = Readonly<{
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  status: "active" | "inactive";
  creditEnabled?: boolean;
  creditLimit?: Money;
}>;
export type Customer = CustomerFields &
  Readonly<{
    id: string;
    tenantId: string;
    createdAt: string;
    lastPurchaseAt?: string;
  }>;
export type CustomerChanges = Partial<
  Pick<CustomerFields, "name" | "status" | "creditEnabled">
> & {
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  creditLimit?: Money | null;
};
export const customerId = (value: string): string =>
  productId(value).toLowerCase();
export function customerFields(input: CustomerFields): CustomerFields {
  if (!input || typeof input !== "object")
    throw new TypeError("Invalid customer");
  const text = (value: string, max: number) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > max ||
      Array.from(value).some(
        (c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)),
      )
    )
      throw new TypeError("Invalid customer field");
    return value.trim();
  };
  if (input.status !== "active" && input.status !== "inactive")
    throw new TypeError("Invalid customer status");
  if (
    input.creditEnabled !== undefined &&
    typeof input.creditEnabled !== "boolean"
  )
    throw new TypeError("Invalid credit settings");
  const limit =
    input.creditLimit === undefined
      ? undefined
      : money(input.creditLimit.minorUnits);
  if (limit && (input.creditLimit?.currency !== "MXN" || limit.minorUnits < 0n))
    throw new TypeError("Invalid credit limit");
  return Object.freeze({
    name: text(input.name, 200),
    status: input.status,
    ...(input.creditEnabled === undefined
      ? {}
      : { creditEnabled: input.creditEnabled }),
    ...(limit === undefined ? {} : { creditLimit: limit }),
    ...(input.phone === undefined ? {} : { phone: text(input.phone, 50) }),
    ...(input.email === undefined ? {} : { email: text(input.email, 254) }),
    ...(input.notes === undefined ? {} : { notes: text(input.notes, 2000) }),
  });
}

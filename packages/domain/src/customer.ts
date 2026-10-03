import { productId } from "./product-fields";
export type CustomerFields = Readonly<{
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  status: "active" | "inactive";
}>;
export type Customer = CustomerFields &
  Readonly<{
    id: string;
    tenantId: string;
    createdAt: string;
    lastPurchaseAt?: string;
  }>;
export type CustomerChanges = Partial<
  Pick<CustomerFields, "name" | "status">
> & { phone?: string | null; email?: string | null; notes?: string | null };
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
  return Object.freeze({
    name: text(input.name, 200),
    status: input.status,
    ...(input.phone === undefined ? {} : { phone: text(input.phone, 50) }),
    ...(input.email === undefined ? {} : { email: text(input.email, 254) }),
    ...(input.notes === undefined ? {} : { notes: text(input.notes, 2000) }),
  });
}

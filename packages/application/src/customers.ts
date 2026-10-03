import type {
  Customer,
  CustomerFields,
  CustomerChanges,
  Money,
} from "@smartretail/domain";
export class CustomerNotFoundError extends Error {}
export class CustomerUnavailableError extends Error {}
export type CustomerSale = Readonly<{
  id: string;
  createdAt: string;
  total: Money;
  paymentMethods: readonly ("cash" | "card")[];
  returnedTotal: Money;
}>;
export interface CustomerRepository {
  listCustomers(search?: string): Promise<readonly Customer[]>;
  createCustomer(id: string, fields: CustomerFields): Promise<Customer>;
  updateCustomer(id: string, changes: CustomerChanges): Promise<Customer>;
  readCustomer(
    id: string,
  ): Promise<Readonly<{ customer: Customer; sales: readonly CustomerSale[] }>>;
}

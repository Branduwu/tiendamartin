import type { Pool, PoolClient } from "pg";
import {
  customerId,
  customerFields,
  money,
  type Customer,
  type CustomerFields,
  type CustomerChanges,
} from "@smartretail/domain";
import {
  CustomerNotFoundError,
  PermissionDeniedError,
  type CustomerRepository,
  type CustomerSale,
  type AuthenticatedContext,
} from "@smartretail/application";
import { PostgresInventory } from "./database";
import { integer } from "./mapping";
type Row = {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: "active" | "inactive";
  credit_enabled: boolean;
  credit_limit_minor_units: string | null;
  created_at: Date;
  last_purchase_at?: Date | null;
};
const mapped = (r: Row): Customer =>
  Object.freeze({
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    creditEnabled: r.credit_enabled,
    ...(r.credit_limit_minor_units === null
      ? {}
      : { creditLimit: money(integer(r.credit_limit_minor_units)) }),
    ...(r.phone === null ? {} : { phone: r.phone }),
    ...(r.email === null ? {} : { email: r.email }),
    ...(r.notes === null ? {} : { notes: r.notes }),
    ...(r.last_purchase_at
      ? { lastPurchaseAt: r.last_purchase_at.toISOString() }
      : {}),
  });
export class PostgresCustomers
  extends PostgresInventory
  implements CustomerRepository
{
  constructor(
    pool: Pool,
    context: AuthenticatedContext,
    private readonly correlation: string = globalThis.crypto.randomUUID(),
  ) {
    super(pool, context);
    customerId(correlation);
  }
  private async scope<T>(
    permission: "customers.read" | "customers.write",
    work: (c: PoolClient) => Promise<T>,
  ) {
    return this.transaction(permission, async (c) => {
      await c.query("SELECT set_config('app.correlation_id',$1,true)", [
        this.correlation,
      ]);
      return work(c);
    });
  }
  async listCustomers(search = ""): Promise<readonly Customer[]> {
    if (typeof search !== "string" || search.length > 200)
      throw new TypeError("Invalid customer search");
    return this.scope("customers.read", async (c) => {
      const rows = await c.query<Row>(
        "SELECT c.*,s.last_purchase_at FROM retail.customers c LEFT JOIN LATERAL(SELECT max(created_at) AS last_purchase_at FROM retail.sales WHERE tenant_id=c.tenant_id AND customer_id=c.id) s ON true WHERE c.tenant_id=$1 AND ($2='' OR strpos(lower(concat_ws(' ',c.name,c.phone,c.email)),lower($2))>0) ORDER BY lower(c.name),c.id LIMIT 100",
        [this.tenant, search.trim()],
      );
      return rows.rows.map(mapped);
    });
  }
  async createCustomer(id: string, input: CustomerFields): Promise<Customer> {
    const value = customerFields(input),
      valid = customerId(id);
    if (
      value.creditLimit &&
      value.creditLimit.minorUnits > 9223372036854775807n
    )
      throw new RangeError("Credit limit exceeds storage range");
    return this.scope("customers.write", async (c) => {
      const r = await c.query<Row>(
        "INSERT INTO retail.customers(id,tenant_id,name,phone,email,notes,status,credit_enabled,credit_limit_minor_units) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [
          valid,
          this.tenant,
          value.name,
          value.phone ?? null,
          value.email ?? null,
          value.notes ?? null,
          value.status,
          value.creditEnabled ?? false,
          value.creditLimit?.minorUnits.toString() ?? null,
        ],
      );
      const row = r.rows[0];
      if (!row) throw new Error("Customer insert missing");
      return mapped(row);
    });
  }
  async updateCustomer(
    id: string,
    changes: CustomerChanges,
  ): Promise<Customer> {
    const valid = customerId(id);
    if (!changes || !Object.keys(changes).length)
      throw new TypeError("Empty customer update");
    return this.scope("customers.write", async (c) => {
      const old = (
        await c.query<Row>(
          "SELECT * FROM retail.customers WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [this.tenant, valid],
        )
      ).rows[0];
      if (!old) throw new CustomerNotFoundError();
      const input: CustomerFields = {
        name: changes.name ?? old.name,
        status: changes.status ?? old.status,
        creditEnabled: changes.creditEnabled ?? old.credit_enabled,
        ...((changes.creditLimit === undefined
          ? old.credit_limit_minor_units === null
            ? null
            : money(integer(old.credit_limit_minor_units))
          : changes.creditLimit) === null
          ? {}
          : {
              creditLimit:
                changes.creditLimit ??
                money(integer(old.credit_limit_minor_units!)),
            }),
        ...((changes.phone === undefined ? old.phone : changes.phone) === null
          ? {}
          : {
              phone:
                (changes.phone === undefined ? old.phone : changes.phone) ?? "",
            }),
        ...((changes.email === undefined ? old.email : changes.email) === null
          ? {}
          : {
              email:
                (changes.email === undefined ? old.email : changes.email) ?? "",
            }),
        ...((changes.notes === undefined ? old.notes : changes.notes) === null
          ? {}
          : {
              notes:
                (changes.notes === undefined ? old.notes : changes.notes) ?? "",
            }),
      };
      const value = customerFields(input);
      if (
        value.creditLimit &&
        value.creditLimit.minorUnits > 9223372036854775807n
      )
        throw new RangeError("Credit limit exceeds storage range");
      const row = (
        await c.query<Row>(
          "UPDATE retail.customers SET name=$3,phone=$4,email=$5,notes=$6,status=$7,credit_enabled=$8,credit_limit_minor_units=$9 WHERE tenant_id=$1 AND id=$2 RETURNING *",
          [
            this.tenant,
            valid,
            value.name,
            value.phone ?? null,
            value.email ?? null,
            value.notes ?? null,
            value.status,
            value.creditEnabled ?? false,
            value.creditLimit?.minorUnits.toString() ?? null,
          ],
        )
      ).rows[0];
      if (!row) throw new CustomerNotFoundError();
      return mapped(row);
    });
  }
  async readCustomer(id: string) {
    const valid = customerId(id);
    return this.scope("customers.read", async (c) => {
      const customer = (
        await c.query<Row>(
          "SELECT * FROM retail.customers WHERE tenant_id=$1 AND id=$2",
          [this.tenant, valid],
        )
      ).rows[0];
      if (!customer) throw new CustomerNotFoundError();
      const allowed = (
        await c.query<{ allowed: boolean }>(
          "SELECT retail.has_permission('sales.read') AS allowed",
        )
      ).rows[0]?.allowed;
      if (!allowed) throw new PermissionDeniedError();
      const rows = await c.query<{
        id: string;
        created_at: Date;
        total_minor_units: string;
        methods: ("cash" | "card" | "credit")[];
        returned: string;
      }>(
        "SELECT s.id,s.created_at,s.total_minor_units,ARRAY(SELECT p.method FROM retail.sale_payments p WHERE p.tenant_id=s.tenant_id AND p.sale_id=s.id ORDER BY p.method) AS methods,(SELECT coalesce(sum(r.total_minor_units),0)::text FROM retail.sale_returns r WHERE r.tenant_id=s.tenant_id AND r.sale_id=s.id) AS returned FROM retail.sales s WHERE s.tenant_id=$1 AND s.customer_id=$2 ORDER BY s.created_at DESC,s.id DESC LIMIT 50",
        [this.tenant, valid],
      );
      const sales: readonly CustomerSale[] = rows.rows.map((r) =>
        Object.freeze({
          id: r.id,
          createdAt: r.created_at.toISOString(),
          total: money(integer(r.total_minor_units)),
          paymentMethods: Object.freeze(r.methods),
          returnedTotal: money(integer(r.returned)),
        }),
      );
      return Object.freeze({
        customer: mapped(customer),
        sales: Object.freeze(sales),
      });
    });
  }
}

import {
  customerId,
  saleId,
  money,
  ReceivableConflictError,
  type Money,
} from "@smartretail/domain";
import {
  SaleNotFoundError,
  CashStateConflictError,
} from "@smartretail/application";
import { PostgresInventory, DatabaseUniquenessConflictError } from "./database";
import type { PoolClient } from "pg";
type MoneyDto = Readonly<{ currency: "MXN"; minorUnits: string }>;
type PaymentInput = Readonly<{
  id: string;
  method: "cash" | "card";
  amount: Money;
  shiftId?: string;
}>;
type Row = {
  id: string;
  tenant_id: string;
  sale_id: string;
  customer_id: string;
  customer_name: string;
  location_id: string;
  original_minor_units: string;
  outstanding_minor_units: string;
  paid: string;
  returned: string;
  status: "open" | "partially_paid" | "paid";
  created_at: Date;
};
const amount = (minorUnits: string): MoneyDto => ({
  currency: "MXN",
  minorUnits,
});
const dto = (r: Row) => ({
  id: r.id,
  tenantId: r.tenant_id,
  saleId: r.sale_id,
  customerId: r.customer_id,
  customerName: r.customer_name,
  locationId: r.location_id,
  originalAmount: amount(r.original_minor_units),
  outstandingAmount: amount(r.outstanding_minor_units),
  paidAmount: amount(r.paid),
  returnedAmount: amount(r.returned),
  status: r.status,
  createdAt: r.created_at.toISOString(),
});
const accounts =
  "SELECT r.*,(SELECT coalesce(sum(p.amount_minor_units),0)::text FROM retail.receivable_payments p WHERE p.tenant_id=r.tenant_id AND p.receivable_id=r.id) AS paid,(SELECT coalesce(sum(a.amount_minor_units),0)::text FROM retail.receivable_adjustments a WHERE a.tenant_id=r.tenant_id AND a.receivable_id=r.id) AS returned FROM retail.receivables r";
export class PostgresReceivables extends PostgresInventory {
  private async account(c: PoolClient, id: string) {
    const row = (
      await c.query<Row>(accounts + " WHERE r.tenant_id=$1 AND r.id=$2", [
        this.tenant,
        id,
      ])
    ).rows[0];
    if (!row) throw new SaleNotFoundError();
    return dto(row);
  }
  async list(customer?: string, before?: string) {
    const id = customer === undefined ? null : customerId(customer);
    const cursor = before === undefined ? null : saleId(before);
    return this.transaction("receivables.read", async (c) =>
      (
        await c.query<Row>(
          accounts +
            " WHERE r.tenant_id=$1 AND ($2::uuid IS NULL OR r.customer_id=$2) AND ($3::uuid IS NULL OR (r.created_at,r.id)<(SELECT created_at,id FROM retail.receivables WHERE tenant_id=$1 AND id=$3)) ORDER BY r.created_at DESC,r.id DESC LIMIT 100",
          [this.tenant, id, cursor],
        )
      ).rows.map(dto),
    );
  }
  async summary(customer: string) {
    return this.transaction("customers.read", async (c) => {
      const r = (
        await c.query<{ outstanding: string }>(
          "SELECT * FROM retail.customer_credit_summary($1)",
          [customerId(customer)],
        )
      ).rows[0];
      if (!r) throw new SaleNotFoundError();
      return amount(r.outstanding);
    });
  }
  private async payments(
    c: PoolClient,
    id: string,
    customer = false,
    before?: string,
  ) {
    const result = await c.query<{
      id: string;
      receivable_id: string;
      method: "cash" | "card";
      amount_minor_units: string;
      created_at: Date;
      created_by: string;
      shift_id: string | null;
    }>(
      "SELECT p.* FROM retail.receivable_payments p JOIN retail.receivables r ON r.tenant_id=p.tenant_id AND r.id=p.receivable_id WHERE p.tenant_id=$1 AND " +
        (customer ? "r.customer_id=$2" : "p.receivable_id=$2") +
        " AND ($3::uuid IS NULL OR (p.created_at,p.id)<(SELECT created_at,id FROM retail.receivable_payments WHERE tenant_id=$1 AND id=$3)) ORDER BY p.created_at DESC,p.id DESC LIMIT 100",
      [this.tenant, id, before === undefined ? null : saleId(before)],
    );
    return result.rows.map((p) => ({
      id: p.id,
      receivableId: p.receivable_id,
      method: p.method,
      amount: amount(p.amount_minor_units),
      createdAt: p.created_at.toISOString(),
      createdBy: p.created_by,
      shiftId: p.shift_id,
    }));
  }
  async customerPayments(id: string, before?: string) {
    return this.transaction("receivables.read", async (c) =>
      this.payments(c, customerId(id), true, before),
    );
  }
  async read(id: string, before?: string) {
    const valid = saleId(id);
    return this.transaction("receivables.read", async (c) => ({
      receivable: await this.account(c, valid),
      payments: await this.payments(c, valid, false, before),
    }));
  }
  async collect(id: string, input: PaymentInput, correlation: string) {
    const valid = saleId(id),
      pid = saleId(input.id),
      value = money(input.amount.minorUnits);
    if (
      input.amount.currency !== "MXN" ||
      value.minorUnits <= 0n ||
      !["cash", "card"].includes(input.method) ||
      (input.method === "cash") !== (input.shiftId !== undefined)
    )
      throw new TypeError("Invalid collection");
    if (input.shiftId !== undefined) saleId(input.shiftId);
    saleId(correlation);
    try {
      return await this.transaction("receivables.pay", async (c) => {
        const result = await c.query<{ replayed: boolean }>(
          "SELECT retail.collect_receivable($1,$2,$3,$4,$5,$6) AS replayed",
          [
            pid,
            valid,
            input.method,
            value.minorUnits.toString(),
            input.shiftId ?? null,
            correlation,
          ],
        );
        return {
          receivable: await this.account(c, valid),
          payments: await this.payments(c, valid),
          replayed: result.rows[0]?.replayed ?? false,
        };
      });
    } catch (e) {
      if (e instanceof DatabaseUniquenessConflictError)
        throw new ReceivableConflictError();
      if (e instanceof Error && "code" in e) {
        if (e.code === "P0001") throw new ReceivableConflictError();
        if (e.code === "P0002") throw new SaleNotFoundError();
        if (e.code === "22003")
          throw new RangeError("Collection exceeds storage range");
        if (e.code === "23503") throw new CashStateConflictError();
      }
      throw e;
    }
  }
}

import {
  money,
  productId,
  PayableConflictError,
  type Money,
} from "@smartretail/domain";
import {
  PurchasingNotFoundError,
  type Permission,
} from "@smartretail/application";
import type { PoolClient } from "pg";
import { PostgresInventory, DatabaseUniquenessConflictError } from "./database";
type Payment = {
  id: string;
  method: "cash" | "card" | "bank";
  amount: Money;
  shiftId?: string;
};
type ExpenseInput = Payment & {
  category:
    | "renta"
    | "servicios"
    | "transporte"
    | "mantenimiento"
    | "insumos"
    | "otros";
  description: string;
  locationId?: string;
};
type AccountRow = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  purchase_order_id: string;
  location_id: string;
  original_minor_units: string;
  outstanding_minor_units: string;
  paid: string;
  status: "open" | "partially_paid" | "paid";
  created_at: Date;
};
const dto = (r: AccountRow) => ({
  id: r.id,
  supplierId: r.supplier_id,
  supplierName: r.supplier_name,
  purchaseOrderId: r.purchase_order_id,
  locationId: r.location_id,
  originalAmount: {
    currency: "MXN" as const,
    minorUnits: r.original_minor_units,
  },
  paidAmount: { currency: "MXN" as const, minorUnits: r.paid },
  outstandingAmount: {
    currency: "MXN" as const,
    minorUnits: r.outstanding_minor_units,
  },
  status: r.status,
  createdAt: r.created_at.toISOString(),
});
const accounts =
  "SELECT a.*,(a.original_minor_units-a.outstanding_minor_units)::text AS paid FROM retail.payables a";
export class PostgresPayables extends PostgresInventory {
  private async scope<T>(
    permission: Permission,
    work: (c: PoolClient) => Promise<T>,
  ) {
    try {
      return await this.transaction(permission, work);
    } catch (e: unknown) {
      if (e instanceof DatabaseUniquenessConflictError)
        throw new PayableConflictError("Identifier conflict");
      if (e instanceof Error && "code" in e) {
        if (e.code === "P0002") throw new PurchasingNotFoundError();
        if (["P0001", "23514", "23503"].includes(String(e.code)))
          throw new PayableConflictError(
            "Payment, cash or references conflict",
          );
        if (["22003", "22023"].includes(String(e.code)))
          throw new RangeError("Invalid financial input or storage range");
      }
      throw e;
    }
  }
  async list(supplier?: string, before?: string) {
    if (supplier) productId(supplier);
    if (before) productId(before);
    return this.scope("payables.read", async (c) =>
      (
        await c.query<AccountRow>(
          accounts +
            " WHERE a.tenant_id=$1 AND ($2::uuid IS NULL OR a.supplier_id=$2) AND ($3::uuid IS NULL OR (a.created_at,a.id)<(SELECT created_at,id FROM retail.payables WHERE tenant_id=$1 AND id=$3)) ORDER BY a.created_at DESC,a.id DESC LIMIT 100",
          [this.tenant, supplier ?? null, before ?? null],
        )
      ).rows.map(dto),
    );
  }
  async supplierSummary(id: string, before?: string, purchasesBefore?: string) {
    if (purchasesBefore) productId(purchasesBefore);
    if (before) productId(before);
    productId(id);
    return this.scope("payables.read", async (c) => {
      const summary = (
        await c.query<{ outstanding: string; openAccounts: string }>(
          'SELECT coalesce(sum(outstanding_minor_units),0)::text AS outstanding,count(*) FILTER(WHERE outstanding_minor_units>0)::text AS "openAccounts" FROM retail.payables WHERE tenant_id=$1 AND supplier_id=$2',
          [this.tenant, id],
        )
      ).rows[0];
      const payments = (
        await c.query<{
          id: string;
          payable_id: string;
          method: string;
          amount_minor_units: string;
          created_at: Date;
        }>(
          "SELECT p.* FROM retail.payable_payments p JOIN retail.payables a ON a.tenant_id=p.tenant_id AND a.id=p.payable_id WHERE p.tenant_id=$1 AND a.supplier_id=$2 AND ($3::uuid IS NULL OR (p.created_at,p.id)<(SELECT created_at,id FROM retail.payable_payments WHERE tenant_id=$1 AND id=$3)) ORDER BY p.created_at DESC,p.id DESC LIMIT 100",
          [this.tenant, id, before ?? null],
        )
      ).rows.map((r) => ({
        id: r.id,
        payableId: r.payable_id,
        method: r.method,
        amount: { currency: "MXN" as const, minorUnits: r.amount_minor_units },
        createdAt: r.created_at.toISOString(),
      }));
      const purchases = (
        await c.query<{ id: string; status: string; created_at: Date }>(
          "SELECT id,status,created_at FROM retail.purchase_orders WHERE tenant_id=$1 AND supplier_id=$2 AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM retail.purchase_orders WHERE tenant_id=$1 AND id=$3)) ORDER BY created_at DESC,id DESC LIMIT 100",
          [this.tenant, id, purchasesBefore ?? null],
        )
      ).rows.map((p) => ({
        id: p.id,
        status: p.status,
        createdAt: p.created_at.toISOString(),
      }));
      return { ...summary, payments, purchases };
    });
  }
  async read(id: string, before?: string) {
    if (before) productId(before);
    productId(id);
    return this.scope("payables.read", async (c) => {
      const r = (
        await c.query<AccountRow>(
          accounts + " WHERE a.tenant_id=$1 AND a.id=$2",
          [this.tenant, id],
        )
      ).rows[0];
      if (!r) throw new PurchasingNotFoundError();
      const payments = (
        await c.query<{
          id: string;
          method: string;
          amount_minor_units: string;
          created_at: Date;
          created_by: string;
        }>(
          "SELECT id,method,amount_minor_units,created_at,created_by FROM retail.payable_payments WHERE tenant_id=$1 AND payable_id=$2 AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM retail.payable_payments WHERE tenant_id=$1 AND id=$3)) ORDER BY created_at DESC,id DESC LIMIT 100",
          [this.tenant, id, before ?? null],
        )
      ).rows.map((p) => ({
        id: p.id,
        method: p.method,
        amount: { currency: "MXN" as const, minorUnits: p.amount_minor_units },
        createdAt: p.created_at.toISOString(),
        createdBy: p.created_by,
      }));
      return { payable: dto(r), payments };
    });
  }
  private value(input: Payment) {
    productId(input.id);
    const v = money(input.amount.minorUnits);
    if (
      input.amount.currency !== "MXN" ||
      v.minorUnits <= 0n ||
      v.minorUnits > 9223372036854775807n ||
      !["cash", "card", "bank"].includes(input.method) ||
      (input.method === "cash") !== (input.shiftId !== undefined)
    )
      throw new TypeError("Invalid financial amount");
    if (input.shiftId) productId(input.shiftId);
    return v.minorUnits.toString();
  }
  async pay(id: string, input: Payment, correlation: string) {
    productId(id);
    productId(correlation);
    const amount = this.value(input);
    return this.scope("payables.pay", async (c) => ({
      replayed:
        (
          await c.query<{ replayed: boolean }>(
            "SELECT retail.pay_supplier($1,$2,$3,$4,$5,$6) AS replayed",
            [
              input.id,
              id,
              input.method,
              amount,
              input.shiftId ?? null,
              correlation,
            ],
          )
        ).rows[0]?.replayed ?? false,
    }));
  }
  async createExpense(input: ExpenseInput, correlation: string) {
    productId(correlation);
    if (input.locationId) productId(input.locationId);
    const amount = this.value(input);
    if (
      ![
        "renta",
        "servicios",
        "transporte",
        "mantenimiento",
        "insumos",
        "otros",
      ].includes(input.category) ||
      typeof input.description !== "string" ||
      input.description.trim() !== input.description ||
      input.description.length < 1 ||
      input.description.length > 500 ||
      /\p{Cc}/u.test(input.description) ||
      (input.method === "cash" && !input.locationId)
    )
      throw new TypeError("Invalid expense");
    return this.scope("expenses.write", async (c) => ({
      replayed:
        (
          await c.query<{ replayed: boolean }>(
            "SELECT retail.create_expense($1,$2,$3,$4,$5,$6,$7,$8) AS replayed",
            [
              input.id,
              input.category,
              input.description,
              amount,
              input.method,
              input.locationId ?? null,
              input.shiftId ?? null,
              correlation,
            ],
          )
        ).rows[0]?.replayed ?? false,
    }));
  }
  async expenses(before?: string) {
    if (before) productId(before);
    return this.scope("expenses.read", async (c) =>
      (
        await c.query<{
          id: string;
          category: string;
          description: string;
          amount_minor_units: string;
          method: string;
          location_id: string | null;
          created_at: Date;
          created_by: string;
        }>(
          "SELECT * FROM retail.expenses WHERE tenant_id=$1 AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM retail.expenses WHERE tenant_id=$1 AND id=$2)) ORDER BY created_at DESC,id DESC LIMIT 100",
          [this.tenant, before ?? null],
        )
      ).rows.map((r) => ({
        id: r.id,
        category: r.category,
        description: r.description,
        amount: { currency: "MXN" as const, minorUnits: r.amount_minor_units },
        method: r.method,
        locationId: r.location_id,
        createdBy: r.created_by,
        createdAt: r.created_at.toISOString(),
      })),
    );
  }
}

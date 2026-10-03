const randomUUID = () => globalThis.crypto.randomUUID();
import type { Pool, PoolClient } from "pg";
import {
  supplierFields,
  purchaseDraft,
  purchaseReceipt,
  receivePurchase,
  PurchaseConflictError,
  productId,
  quantity,
  money,
  createInventoryReceipt,
  inventoryMovementId,
  inventoryLocationId,
  applyInventoryMovement,
  type Supplier,
  type SupplierFields,
  type SupplierChanges,
  type PurchaseDraftInput,
  type PurchaseOrder,
  type PurchaseStatus,
  type PurchaseReceiptInput,
  type UnitCode,
} from "@smartretail/domain";
import {
  PurchasingNotFoundError,
  PermissionDeniedError,
  type PurchasingRepository,
  type AuthenticatedContext,
  type Permission,
} from "@smartretail/application";
import { PostgresInventory, DatabaseUniquenessConflictError } from "./database";
import {
  integer,
  bigintParameter,
  balanceFromRow,
  type BalanceRow,
} from "./mapping";
interface SupplierRow {
  id: string;
  tenant_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: "active" | "inactive";
  created_at: Date;
}
interface OrderRow {
  id: string;
  tenant_id: string;
  supplier_id: string;
  location_id: string;
  status: PurchaseStatus;
  notes: string | null;
  created_by: string;
  created_at: Date;
  ordered_at: Date | null;
}
interface LineRow {
  purchase_id: string;
  product_id: string;
  unit: UnitCode;
  quantity_ordered: string;
  quantity_received: string;
  unit_cost: string;
}
function supplier(row: SupplierRow): Supplier {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    createdAt: row.created_at.toISOString(),
    ...supplierFields({
      name: row.name,
      status: row.status,
      ...(row.contact_name === null ? {} : { contactName: row.contact_name }),
      ...(row.phone === null ? {} : { phone: row.phone }),
      ...(row.email === null ? {} : { email: row.email }),
      ...(row.notes === null ? {} : { notes: row.notes }),
    }),
  });
}
function order(row: OrderRow, lines: readonly LineRow[]): PurchaseOrder {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    supplierId: row.supplier_id,
    locationId: row.location_id,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    ...(row.ordered_at === null
      ? {}
      : { orderedAt: row.ordered_at.toISOString() }),
    ...(row.notes === null ? {} : { notes: row.notes }),
    lines: Object.freeze(
      lines.map((l) =>
        Object.freeze({
          productId: productId(l.product_id),
          quantityOrdered: quantity(l.unit, integer(l.quantity_ordered)),
          quantityReceived: quantity(l.unit, integer(l.quantity_received)),
          unitCost: money(integer(l.unit_cost)),
        }),
      ),
    ),
  });
}

export class PostgresPurchasing
  extends PostgresInventory
  implements PurchasingRepository
{
  private readonly correlation: string | undefined;
  constructor(
    pool: Pool,
    context: AuthenticatedContext,
    correlationId?: string,
  ) {
    super(pool, context);
    this.correlation =
      correlationId === undefined
        ? undefined
        : productId(correlationId).toLowerCase();
  }
  private scope<T>(
    permission: Permission,
    work: (client: PoolClient) => Promise<T>,
    commandId?: string,
  ): Promise<T> {
    return this.transaction(permission, async (client) => {
      await client.query("SELECT set_config('app.correlation_id',$1,true)", [
        this.correlation ?? commandId ?? randomUUID(),
      ]);
      return work(client);
    }).catch((error: unknown) => {
      if (error instanceof DatabaseUniquenessConflictError)
        throw new PurchaseConflictError("Identifier already used");
      if (error instanceof Error && "code" in error) {
        if (["P0001", "23514", "23503"].includes(String(error.code)))
          throw new PurchaseConflictError(
            "Purchase state or references conflict",
          );
        if (error.code === "22003")
          throw new RangeError("Purchase exceeds storage range");
      }
      throw error;
    });
  }
  async listSuppliers() {
    return this.scope("suppliers.read", async (c) =>
      (
        await c.query<SupplierRow>(
          "SELECT * FROM retail.suppliers WHERE tenant_id=$1 ORDER BY name,id",
          [this.tenant],
        )
      ).rows.map(supplier),
    );
  }
  async createSupplier(id: string, input: SupplierFields) {
    const f = supplierFields(input);
    return this.scope("suppliers.write", async (c) => {
      const result = await c.query<SupplierRow>(
        "INSERT INTO retail.suppliers(id,tenant_id,name,contact_name,phone,email,notes,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          productId(id).toLowerCase(),
          this.tenant,
          f.name,
          f.contactName ?? null,
          f.phone ?? null,
          f.email ?? null,
          f.notes ?? null,
          f.status,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Missing supplier");
      return supplier(row);
    });
  }
  async updateSupplier(id: string, changes: SupplierChanges) {
    return this.scope("suppliers.write", async (c) => {
      const current = (
        await c.query<SupplierRow>(
          "SELECT * FROM retail.suppliers WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [this.tenant, productId(id).toLowerCase()],
        )
      ).rows[0];
      if (!current) throw new PurchasingNotFoundError();
      const present = supplier(current);
      const contactName =
        changes.contactName === undefined
          ? present.contactName
          : changes.contactName;
      const phone = changes.phone === undefined ? present.phone : changes.phone;
      const email = changes.email === undefined ? present.email : changes.email;
      const notes = changes.notes === undefined ? present.notes : changes.notes;
      const f = supplierFields({
        name: changes.name ?? present.name,
        status: changes.status ?? present.status,
        ...(contactName == null ? {} : { contactName }),
        ...(phone == null ? {} : { phone }),
        ...(email == null ? {} : { email }),
        ...(notes == null ? {} : { notes }),
      });
      const result = await c.query<SupplierRow>(
        "UPDATE retail.suppliers SET name=$3,contact_name=$4,phone=$5,email=$6,notes=$7,status=$8 WHERE tenant_id=$1 AND id=$2 RETURNING *",
        [
          this.tenant,
          current.id,
          f.name,
          f.contactName ?? null,
          f.phone ?? null,
          f.email ?? null,
          f.notes ?? null,
          f.status,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new PurchasingNotFoundError();
      return supplier(row);
    });
  }
  private async read(c: PoolClient, id: string, lock = false) {
    const row = (
      await c.query<OrderRow>(
        `SELECT * FROM retail.purchase_orders WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
        [this.tenant, productId(id).toLowerCase()],
      )
    ).rows[0];
    if (!row) throw new PurchasingNotFoundError();
    const lines = (
      await c.query<LineRow>(
        "SELECT * FROM retail.purchase_order_lines WHERE tenant_id=$1 AND purchase_id=$2 ORDER BY product_id",
        [this.tenant, row.id],
      )
    ).rows;
    return order(row, lines);
  }
  async readPurchase(id: string) {
    return this.scope("purchases.read", (c) => this.read(c, id));
  }
  async listPurchases() {
    return this.scope("purchases.read", async (c) => {
      const rows = (
        await c.query<OrderRow>(
          "SELECT * FROM retail.purchase_orders WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
          [this.tenant],
        )
      ).rows;
      const lines = (
        await c.query<LineRow>(
          "SELECT * FROM retail.purchase_order_lines WHERE tenant_id=$1 AND purchase_id=ANY($2::uuid[]) ORDER BY product_id",
          [this.tenant, rows.map((r) => r.id)],
        )
      ).rows;
      return rows.map((r) =>
        order(
          r,
          lines.filter((l) => l.purchase_id === r.id),
        ),
      );
    });
  }
  private async references(c: PoolClient, input: PurchaseDraftInput) {
    const active = (
      await c.query(
        "SELECT 1 FROM retail.suppliers WHERE tenant_id=$1 AND id=$2 AND status='active' FOR SHARE",
        [this.tenant, input.supplierId],
      )
    ).rowCount;
    const location = (
      await c.query(
        "SELECT 1 FROM retail.inventory_locations WHERE tenant_id=$1 AND id=$2 AND status='active'",
        [this.tenant, input.locationId],
      )
    ).rowCount;
    if (!active || !location) throw new PermissionDeniedError();
    for (const l of [...input.lines].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    )) {
      const row = (
        await c.query<{ unit: UnitCode; status: string }>(
          "SELECT unit,status FROM retail.products WHERE tenant_id=$1 AND id=$2 FOR SHARE",
          [this.tenant, l.productId],
        )
      ).rows[0];
      if (!row) throw new PermissionDeniedError();
      if (row.status !== "active" || row.unit !== l.quantityOrdered.unit)
        throw new PurchaseConflictError("Product unavailable or unit changed");
    }
  }
  private async lines(c: PoolClient, input: PurchaseDraftInput) {
    for (const l of input.lines)
      await c.query(
        "INSERT INTO retail.purchase_order_lines(tenant_id,purchase_id,product_id,unit,quantity_ordered,unit_cost) VALUES($1,$2,$3,$4,$5,$6)",
        [
          this.tenant,
          input.id,
          l.productId,
          l.quantityOrdered.unit,
          bigintParameter(l.quantityOrdered.milliUnits),
          bigintParameter(l.unitCost.minorUnits),
        ],
      );
  }
  async createPurchase(input: PurchaseDraftInput) {
    const value = purchaseDraft(input);
    return this.scope("purchases.write", async (c) => {
      await this.references(c, value);
      await c.query(
        "INSERT INTO retail.purchase_orders(id,tenant_id,supplier_id,location_id,created_by,notes) VALUES($1,$2,$3,$4,$5,$6)",
        [
          value.id,
          this.tenant,
          value.supplierId,
          value.locationId,
          this.user,
          value.notes ?? null,
        ],
      );
      await this.lines(c, value);
      return this.read(c, value.id);
    });
  }
  async updatePurchase(input: PurchaseDraftInput) {
    const value = purchaseDraft(input);
    return this.scope("purchases.write", async (c) => {
      const current = await this.read(c, value.id, true);
      if (current.status !== "draft")
        throw new PurchaseConflictError("Only draft is editable");
      await this.references(c, value);
      await c.query(
        "UPDATE retail.purchase_orders SET supplier_id=$3,location_id=$4,notes=$5 WHERE tenant_id=$1 AND id=$2",
        [
          this.tenant,
          value.id,
          value.supplierId,
          value.locationId,
          value.notes ?? null,
        ],
      );
      await c.query(
        "DELETE FROM retail.purchase_order_lines WHERE tenant_id=$1 AND purchase_id=$2",
        [this.tenant, value.id],
      );
      await this.lines(c, value);
      return this.read(c, value.id);
    });
  }
  async changePurchase(id: string, action: "order" | "cancel") {
    return this.scope("purchases.write", async (c) => {
      const current = await this.read(c, id, true);
      if (action !== "order" && action !== "cancel")
        throw new TypeError("Invalid purchase action");
      if (
        (action === "order" && current.status !== "draft") ||
        (action === "cancel" &&
          ["received", "cancelled"].includes(current.status))
      )
        throw new PurchaseConflictError("Invalid purchase transition");
      if (action === "order") await this.references(c, current);
      await c.query(
        "UPDATE retail.purchase_orders SET status=$3,ordered_at=CASE WHEN $3='ordered' THEN clock_timestamp() ELSE ordered_at END WHERE tenant_id=$1 AND id=$2",
        [this.tenant, current.id, action === "order" ? "ordered" : "cancelled"],
      );
      return this.read(c, current.id);
    });
  }
  async receivePurchaseOrder(id: string, input: PurchaseReceiptInput) {
    const value = purchaseReceipt(input),
      pid = productId(id).toLowerCase();
    const payload = JSON.stringify({
      purchaseId: pid,
      lines: value.lines.map((l) => ({
        productId: l.productId,
        unit: l.quantity.unit,
        milliUnits: l.quantity.milliUnits.toString(),
      })),
    });
    return this.scope(
      "purchases.receive",
      async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `smartretail.purchase-receipt/${value.id}`,
        ]);
        const prior = (
          await c.query<{ purchase_id: string; command_payload: string }>(
            "SELECT purchase_id,command_payload FROM retail.purchase_receipts WHERE tenant_id=$1 AND id=$2",
            [this.tenant, value.id],
          )
        ).rows[0];
        if (prior) {
          if (prior.purchase_id !== pid || prior.command_payload !== payload)
            throw new PurchaseConflictError("Receipt ID already used");
          return { order: await this.read(c, pid), replayed: true };
        }
        const current = await this.read(c, pid, true);
        const next = receivePurchase(current, value);
        await c.query(
          "INSERT INTO retail.purchase_receipts(id,tenant_id,purchase_id,location_id,created_by,command_payload) VALUES($1,$2,$3,$4,$5,$6)",
          [value.id, this.tenant, pid, current.locationId, this.user, payload],
        );
        for (const l of value.lines) {
          await c.query(
            "INSERT INTO retail.stock_balances(tenant_id,product_id,location_id,unit) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,product_id,location_id) DO NOTHING",
            [this.tenant, l.productId, current.locationId, l.quantity.unit],
          );
          const row = (
            await c.query<BalanceRow>(
              "SELECT * FROM retail.lock_balance($1,$2)",
              [l.productId, current.locationId],
            )
          ).rows[0];
          if (!row) throw new PurchaseConflictError("Stock unavailable");
          const movement = createInventoryReceipt({
            id: inventoryMovementId(randomUUID()),
            productId: l.productId,
            locationId: inventoryLocationId(current.locationId),
            type: "receipt",
            quantity: l.quantity,
          });
          const balance = applyInventoryMovement(balanceFromRow(row), movement);
          await c.query(
            "INSERT INTO retail.inventory_commands(id,tenant_id,kind) VALUES($1,$2,'receipt')",
            [movement.id, this.tenant],
          );
          await c.query(
            "INSERT INTO retail.inventory_movements(id,tenant_id,product_id,location_id,type,unit,amount,balance_after,purchase_receipt_id) VALUES($1,$2,$3,$4,'receipt',$5,$6,$7,$8)",
            [
              movement.id,
              this.tenant,
              l.productId,
              current.locationId,
              l.quantity.unit,
              bigintParameter(l.quantity.milliUnits),
              bigintParameter(balance.quantity.milliUnits),
              value.id,
            ],
          );
          await c.query(
            "INSERT INTO retail.purchase_receipt_lines(tenant_id,receipt_id,purchase_id,product_id,unit,quantity,movement_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              this.tenant,
              value.id,
              pid,
              l.productId,
              l.quantity.unit,
              bigintParameter(l.quantity.milliUnits),
              movement.id,
            ],
          );
          const updated = next.lines.find((o) => o.productId === l.productId);
          if (!updated) throw new Error("Missing purchase line");
          await c.query(
            "UPDATE retail.purchase_order_lines SET quantity_received=$4 WHERE tenant_id=$1 AND purchase_id=$2 AND product_id=$3",
            [
              this.tenant,
              pid,
              l.productId,
              bigintParameter(updated.quantityReceived.milliUnits),
            ],
          );
        }
        await c.query(
          "UPDATE retail.purchase_orders SET status=$3 WHERE tenant_id=$1 AND id=$2",
          [this.tenant, pid, next.status],
        );
        return { order: await this.read(c, pid), replayed: false };
      },
      value.id,
    );
  }
}

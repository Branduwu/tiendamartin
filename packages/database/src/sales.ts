import type { PoolClient } from "pg";
import {
  completeSale,
  saleId,
  salePayments,
  money,
  quantity,
  productId,
  productName,
  sku,
  inventoryLocationId,
  type SaleLine,
  type UnitCode,
} from "@smartretail/domain";
import {
  CustomerUnavailableError,
  SaleIdempotencyConflictError,
  SaleNotFoundError,
  CashStateConflictError,
  SuspensionConflictError,
  StockBalanceNotFoundError,
  InventoryIdempotencyConflictError,
  type SaleUnitOfWork,
  type SaleTransaction,
  type StoredSale,
} from "@smartretail/application";
import { PostgresInventory, DatabaseUniquenessConflictError } from "./database";
import {
  bigintParameter,
  integer,
  balanceFromRow,
  productFromRow,
  locationFromRow,
  type ProductRow,
  type LocationRow,
  type BalanceRow,
} from "./mapping";

interface SaleRow {
  shift_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  id: string;
  tenant_id: string;
  location_id: string;
  total_minor_units: string;
  created_by: string;
  created_by_name?: string | null;
  location_name?: string | null;
  created_at: Date;
  command_payload: string;
}
interface LineRow {
  product_id: string;
  sku: string;
  product_name: string;
  unit: UnitCode;
  quantity_milli_units: string;
  unit_price_minor_units: string;
  line_total_minor_units: string;
}
interface PaymentRow {
  method: "cash" | "card";
  amount_minor_units: string;
}

export class PostgresSales extends PostgresInventory implements SaleUnitOfWork {
  protected async recorded(client: PoolClient, id: string) {
    const found = await client.query<SaleRow>(
      "SELECT * FROM retail.sales WHERE tenant_id=$1 AND id=$2",
      [this.tenant, id],
    );
    const row = found.rows[0];
    if (!row) return undefined;
    const lines = await client.query<LineRow>(
      "SELECT * FROM retail.sale_lines WHERE tenant_id=$1 AND sale_id=$2 ORDER BY ordinal",
      [this.tenant, id],
    );
    const payments = await client.query<PaymentRow>(
      "SELECT * FROM retail.sale_payments WHERE tenant_id=$1 AND sale_id=$2 ORDER BY method",
      [this.tenant, id],
    );
    const snapshots: SaleLine[] = lines.rows.map((l) =>
      Object.freeze({
        productId: productId(l.product_id),
        sku: sku(l.sku),
        name: productName(l.product_name),
        unit: l.unit,
        quantity: quantity(l.unit, integer(l.quantity_milli_units)),
        unitPrice: money(integer(l.unit_price_minor_units)),
        lineTotal: money(integer(l.line_total_minor_units)),
      }),
    );
    const sale = completeSale({
      id: saleId(row.id),
      ...(row.customer_id === null ? {} : { customerId: row.customer_id }),
      status: "draft",
      lines: snapshots,
      total: money(integer(row.total_minor_units)),
    });
    const recorded: StoredSale = Object.freeze({
      shiftId: row.shift_id,
      ...(row.customer_name === null
        ? {}
        : { customerName: row.customer_name }),
      sale,
      payments: salePayments(
        payments.rows.map((p) => ({
          method: p.method,
          amount: money(integer(p.amount_minor_units)),
        })),
        sale.total,
      ),
      tenantId: row.tenant_id,
      locationId: row.location_id,
      createdBy: row.created_by,
      ...(row.created_by_name == null
        ? {}
        : { createdByName: row.created_by_name }),
      ...(row.location_name == null ? {} : { locationName: row.location_name }),
      createdAt: row.created_at.toISOString(),
    });
    return Object.freeze({ payload: row.command_payload, recorded });
  }
  async readSale(id: string): Promise<StoredSale> {
    return this.transaction("sales.read", async (client) => {
      const found = await this.recorded(client, saleId(id));
      if (!found) throw new SaleNotFoundError();
      return found.recorded;
    });
  }
  async listSales(before?: string) {
    return this.transaction("sales.read", async (client) => {
      const result = await client.query<{ id: string }>(
        "SELECT id FROM retail.sales WHERE tenant_id=$1 AND ($2::timestamptz IS NULL OR created_at<$2) ORDER BY created_at DESC,id DESC LIMIT 50",
        [this.tenant, before ?? null],
      );
      const rows: StoredSale[] = [];
      for (const row of result.rows) {
        const found = await this.recorded(client, row.id);
        if (found) rows.push(found.recorded);
      }
      return rows;
    });
  }
  async returnedSaleIds(ids: readonly string[]) {
    return this.transaction("sales.read", async (client) => {
      const rows = await client.query<{ sale_id: string }>(
        "SELECT DISTINCT sale_id FROM retail.sale_returns WHERE tenant_id=$1 AND sale_id=ANY($2::uuid[])",
        [this.tenant, ids.map(saleId)],
      );
      return rows.rows.map((r) => r.sale_id);
    });
  }
  async runSale<T>(
    id: string,
    work: (tx: SaleTransaction) => Promise<T>,
  ): Promise<T> {
    const validId = saleId(id);
    try {
      return await this.transaction("sales.create", async (client) => {
        // Global SaleId serialization, valid across pooled/serverless connections.
        // Hash collisions only serialize unrelated commands; they cannot replay them.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`smartretail.sale/${validId}`],
        );
        let active = true;
        const assertActive = () => {
          if (!active) throw new Error("Sale transaction scope expired");
        };
        const balanceKey = (p: string, l: string) =>
          `${p.toLowerCase()}/${l.toLowerCase()}`;
        const balances = new Map<string, ReturnType<typeof balanceFromRow>>();
        const tx: SaleTransaction = {
          findRecorded: async () => {
            assertActive();
            return this.recorded(client, validId);
          },
          lockSuspendedSale: async (id, location) => {
            assertActive();
            try {
              await client.query("SELECT retail.lock_suspended_sale($1,$2)", [
                id,
                location,
              ]);
            } catch (e) {
              if (e instanceof Error && "code" in e && e.code === "P0001")
                throw new SuspensionConflictError();
              throw e;
            }
          },
          validateCustomer: async (id) => {
            assertActive();
            try {
              await client.query("SELECT retail.lock_sale_customer($1)", [id]);
            } catch (e) {
              if (e instanceof Error && "code" in e && e.code === "P0001")
                throw new CustomerUnavailableError();
              throw e;
            }
          },
          lockOpenShift: async (location, shiftId) => {
            assertActive();
            await this.requireLocation(client, location);
            if (!shiftId) throw new CashStateConflictError();
            try {
              await client.query("SELECT retail.lock_cash_shift($1)", [
                shiftId,
              ]);
            } catch (e) {
              if (e instanceof Error && "code" in e && e.code === "P0001")
                throw new CashStateConflictError();
              throw e;
            }
            const found = await client.query(
              "SELECT 1 FROM retail.cash_register_shifts WHERE tenant_id=$1 AND id=$2 AND location_id=$3",
              [this.tenant, shiftId, location],
            );
            if (!found.rows.length) throw new CashStateConflictError();
          },
          readProduct: async (id) => {
            assertActive();
            const result = await client.query<ProductRow>(
              "SELECT * FROM retail.products WHERE tenant_id=$1 AND id=$2 FOR SHARE",
              [this.tenant, id],
            );
            return result.rows[0] ? productFromRow(result.rows[0]) : undefined;
          },
          readLocation: async (id) => {
            assertActive();
            await this.requireLocation(client, id);
            const result = await client.query<LocationRow>(
              "SELECT * FROM retail.inventory_locations WHERE tenant_id=$1 AND id=$2",
              [this.tenant, id],
            );
            return result.rows[0] ? locationFromRow(result.rows[0]) : undefined;
          },
          lockBalances: async (ids, location) => {
            assertActive();
            for (const product of [
              ...new Set(ids.map((p) => productId(p).toLowerCase())),
            ].sort()) {
              await client.query(
                `INSERT INTO retail.stock_balances(tenant_id,product_id,location_id,unit)
                SELECT $1,p.id,$3,p.unit FROM retail.products p JOIN retail.inventory_locations l ON l.tenant_id=p.tenant_id AND l.id=$3
                WHERE p.tenant_id=$1 AND p.id=$2 ON CONFLICT(tenant_id,product_id,location_id) DO NOTHING`,
                [this.tenant, product, location],
              );
              const found = await client.query<BalanceRow>(
                "SELECT * FROM retail.lock_balance($1,$2)",
                [product, location],
              );
              if (!found.rows[0]) throw new StockBalanceNotFoundError();
              balances.set(
                balanceKey(product, location),
                balanceFromRow(found.rows[0]),
              );
            }
          },
          readBalance: async (product, location) => {
            assertActive();
            const b = balances.get(balanceKey(product, location));
            if (!b) throw new StockBalanceNotFoundError();
            return b;
          },
          appendIssue: async (issue, next) => {
            assertActive();
            await client.query(
              "INSERT INTO retail.inventory_commands(id,tenant_id,kind) VALUES($1,$2,'issue')",
              [issue.id, this.tenant],
            );
            await client.query(
              `INSERT INTO retail.inventory_movements(id,tenant_id,product_id,location_id,type,unit,amount,balance_after,sale_id)
              VALUES($1,$2,$3,$4,'issue',$5,$6,$7,$8)`,
              [
                issue.id,
                this.tenant,
                issue.productId,
                issue.locationId,
                issue.quantity.unit,
                bigintParameter(issue.quantity.milliUnits),
                bigintParameter(next.quantity.milliUnits),
                validId,
              ],
            );
            // apply_ledger is the sole balance writer, within this transaction.
            balances.set(balanceKey(issue.productId, issue.locationId), next);
          },
          persistSale: async (sale, input, payload) => {
            assertActive();
            await client.query(
              `INSERT INTO retail.sales(id,tenant_id,location_id,status,currency,total_minor_units,created_by,command_payload,shift_id,suspended_sale_id,customer_id)
              VALUES($1,$2,$3,'completed','MXN',$4,$5,$6,$7,$8,$9)`,
              [
                validId,
                this.tenant,
                inventoryLocationId(input.locationId),
                bigintParameter(sale.total.minorUnits),
                this.user,
                payload,
                input.shiftId,
                input.suspendedSaleId ?? null,
                sale.customerId ?? null,
              ],
            );
            for (const [ordinal, line] of sale.lines.entries()) {
              const movement = input.movements.find(
                (m) => m.productId === line.productId,
              );
              if (!movement) throw new Error("Missing sale movement");
              await client.query(
                `INSERT INTO retail.sale_lines(tenant_id,sale_id,product_id,ordinal,sku,product_name,unit,quantity_milli_units,unit_price_minor_units,line_total_minor_units,movement_id)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [
                  this.tenant,
                  validId,
                  line.productId,
                  ordinal,
                  line.sku,
                  line.name,
                  line.unit,
                  bigintParameter(line.quantity.milliUnits),
                  bigintParameter(line.unitPrice.minorUnits),
                  bigintParameter(line.lineTotal.minorUnits),
                  movement.movementId,
                ],
              );
            }
            for (const payment of input.payments)
              await client.query(
                "INSERT INTO retail.sale_payments(tenant_id,sale_id,method,amount_minor_units) VALUES($1,$2,$3,$4)",
                [
                  this.tenant,
                  validId,
                  payment.method,
                  bigintParameter(payment.amount.minorUnits),
                ],
              );
            const result = await this.recorded(client, validId);
            if (!result) throw new Error("Sale missing after insert");
            return result.recorded;
          },
        };
        try {
          return await work(tx);
        } finally {
          active = false;
        }
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "22003")
        throw new RangeError("Cash exceeds storage range");
      if (
        error instanceof DatabaseUniquenessConflictError ||
        error instanceof InventoryIdempotencyConflictError
      )
        throw new SaleIdempotencyConflictError();
      throw error;
    }
  }
}

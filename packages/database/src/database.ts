import type { Pool, PoolClient } from "pg";
import { assertApplicationRole } from "./session";
import {
  productId,
  inventoryLocationId,
  stockBalance,
  quantity,
  inventoryMovementId,
  inventoryAdjustmentReason,
  createProduct,
  createInventoryLocation,
  createInventoryReceipt,
  createInventoryIssue,
  createInventoryAdjustment,
  createInventoryTransfer,
  applyInventoryMovement,
  applyInventoryTransfer,
  type Product,
  type InventoryLocation,
  type InventoryMovement,
  type StockBalance,
} from "@smartretail/domain";
import {
  InventoryIdempotencyConflictError,
  StockBalanceNotFoundError,
  authenticatedContext,
  PermissionDeniedError,
  ProductNotFoundError,
  type ProductRepository,
  type InventoryQueries,
  type InventoryStock,
  type ReconcileInventoryInput,
  type InventoryReconciliationResult,
  type AuthenticatedContext,
  type Permission,
  type InventoryUnitOfWork,
  type InventoryTransaction,
  type StockTarget,
} from "@smartretail/application";
import {
  balanceFromRow,
  productFromRow,
  locationFromRow,
  movementFromRow,
  transferFromRow,
  bigintParameter,
  type BalanceRow,
  type ProductRow,
  type LocationRow,
  type MovementRow,
  type TransferRow,
} from "./mapping";

export class DatabaseUniquenessConflictError extends Error {
  constructor() {
    super("Database uniqueness constraint violated");
    this.name = "DatabaseUniquenessConflictError";
  }
}

function key(target: StockTarget): string {
  return `${productId(target.productId).toLowerCase()}/${inventoryLocationId(target.locationId).toLowerCase()}`;
}
function validateMovement(input: InventoryMovement): InventoryMovement {
  switch (input.type) {
    case "receipt":
      return createInventoryReceipt(input);
    case "issue":
      return createInventoryIssue(input);
    case "adjustment":
      return createInventoryAdjustment(input);
    default:
      throw new TypeError("Invalid movement type");
  }
}

export class ProductStorageConflictError extends Error {
  constructor() {
    super("Product unit is referenced by inventory");
    this.name = "ProductStorageConflictError";
  }
}

export class PostgresInventory
  implements InventoryUnitOfWork, ProductRepository, InventoryQueries
{
  protected readonly tenant: string;
  protected readonly user: string;
  constructor(
    private readonly pool: Pool,
    context: AuthenticatedContext,
  ) {
    const valid = authenticatedContext(context);
    this.tenant = valid.tenantId;
    this.user = valid.userId;
  }

  protected async transaction<T>(
    permission: Permission,
    work: (client: PoolClient) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query(
        readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN",
      );
      await client.query("SET LOCAL statement_timeout='15s'");
      await assertApplicationRole(client);
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [
        this.tenant,
      ]);
      await client.query("SELECT set_config('app.user_id',$1,true)", [
        this.user,
      ]);
      await this.requirePermission(client, permission);
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      if (error instanceof Error && "code" in error && error.code === "23505") {
        const constraint = "constraint" in error ? error.constraint : undefined;
        if (
          constraint === "inventory_movements_pkey" ||
          constraint === "inventory_transfers_pkey" ||
          constraint === "inventory_counts_pkey" ||
          constraint ===
            "inventory_transfers_tenant_id_issue_movement_id_key" ||
          constraint === "inventory_transfers_tenant_id_receipt_movement_id_key"
        )
          throw new InventoryIdempotencyConflictError();
        throw new DatabaseUniquenessConflictError();
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }

  private async requirePermission(
    client: PoolClient,
    permission: Permission,
  ): Promise<void> {
    const result = await client.query<{ allowed: boolean }>(
      "SELECT retail.has_permission($1) AS allowed",
      [permission],
    );
    if (result.rows[0]?.allowed !== true) throw new PermissionDeniedError();
  }

  /** Uses current PostgreSQL membership, never a cached/client-supplied role. */
  async authorize(permission: Permission): Promise<void> {
    await this.transaction(permission, async () => undefined);
  }

  async createProduct(input: Product): Promise<Product> {
    const value = createProduct(input);
    return this.transaction("products.write", async (client) => {
      const result = await client.query<ProductRow>(
        `INSERT INTO retail.products
        (tenant_id,id,name,sku,barcode,unit,currency,purchase_cost,sale_price,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          this.tenant,
          value.id,
          value.name,
          value.sku,
          value.barcode ?? null,
          value.unit,
          value.purchaseCost.currency,
          bigintParameter(value.purchaseCost.minorUnits),
          bigintParameter(value.salePrice.minorUnits),
          value.status,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Missing inserted product");
      return productFromRow(row);
    });
  }

  async listProducts(): Promise<readonly Product[]> {
    return this.transaction("products.read", async (client) => {
      const result = await client.query<ProductRow>(
        "SELECT * FROM retail.products WHERE tenant_id=$1 ORDER BY name,id",
        [this.tenant],
      );
      return result.rows.map(productFromRow);
    });
  }

  async editProduct(
    id: string,
    change: (current: Product) => Product,
  ): Promise<Product> {
    const validId = productId(id).toLowerCase();
    try {
      return await this.transaction("products.write", async (client) => {
        const current = await client.query<ProductRow>(
          "SELECT * FROM retail.products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [this.tenant, validId],
        );
        const row = current.rows[0];
        if (!row) throw new ProductNotFoundError();
        const value = createProduct(change(productFromRow(row)));
        if (value.id.toLowerCase() !== validId)
          throw new TypeError("Product identity cannot change");
        const result = await client.query<ProductRow>(
          `UPDATE retail.products SET name=$3,sku=$4,barcode=$5,unit=$6,purchase_cost=$7,sale_price=$8,status=$9
          WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [
            this.tenant,
            validId,
            value.name,
            value.sku,
            value.barcode ?? null,
            value.unit,
            bigintParameter(value.purchaseCost.minorUnits),
            bigintParameter(value.salePrice.minorUnits),
            value.status,
          ],
        );
        const updated = result.rows[0];
        if (!updated) throw new ProductNotFoundError();
        return productFromRow(updated);
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "23503")
        throw new ProductStorageConflictError();
      throw error;
    }
  }

  async createLocation(input: InventoryLocation): Promise<InventoryLocation> {
    const value = createInventoryLocation(input);
    return this.transaction("locations.write", async (client) => {
      const result = await client.query<LocationRow>(
        `INSERT INTO retail.inventory_locations
        (tenant_id,id,code,name,status) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (tenant_id,id) DO NOTHING RETURNING *`,
        [this.tenant, value.id, value.code, value.name, value.status],
      );
      const row =
        result.rows[0] ??
        (
          await client.query<LocationRow>(
            "SELECT * FROM retail.inventory_locations WHERE tenant_id=$1 AND id=$2",
            [this.tenant, value.id],
          )
        ).rows[0];
      if (
        !row ||
        row.code !== value.code ||
        row.name !== value.name ||
        row.status !== value.status
      )
        throw new InventoryIdempotencyConflictError();
      return locationFromRow(row);
    });
  }

  async listLocations(): Promise<readonly InventoryLocation[]> {
    return this.transaction("locations.read", async (client) => {
      const result = await client.query<LocationRow>(
        "SELECT * FROM retail.inventory_locations WHERE tenant_id=$1 ORDER BY name,id",
        [this.tenant],
      );
      return result.rows.map(locationFromRow);
    });
  }

  async listStock(locationId?: string): Promise<readonly InventoryStock[]> {
    const location =
      locationId === undefined
        ? null
        : inventoryLocationId(locationId).toLowerCase();
    return this.transaction("inventory.read", async (client) => {
      if (location) {
        const exists = await client.query(
          "SELECT 1 FROM retail.inventory_locations WHERE tenant_id=$1 AND id=$2",
          [this.tenant, location],
        );
        if (!exists.rowCount) throw new StockBalanceNotFoundError();
      }
      const result = await client.query<
        BalanceRow & {
          product_name: string;
          sku: string;
          location_name: string;
          location_code: string;
          minimum: string | null;
          suggested: string | null;
          state: import("@smartretail/application").InventoryState;
        }
      >(
        `SELECT p.id AS product_id,l.id AS location_id,p.unit,COALESCE(b.milli_units,0)::text AS milli_units,
        p.name AS product_name,p.sku,l.name AS location_name,l.code AS location_code,m.milli_units::text AS minimum,retail.inventory_stock_state(coalesce(b.milli_units,0),m.milli_units) AS state,retail.inventory_shortfall(coalesce(b.milli_units,0),m.milli_units)::text AS suggested
        FROM retail.products p JOIN retail.inventory_locations l ON l.tenant_id=p.tenant_id
        LEFT JOIN retail.stock_balances b ON b.tenant_id=p.tenant_id AND b.product_id=p.id AND b.location_id=l.id
        LEFT JOIN retail.inventory_minimums m ON m.tenant_id=p.tenant_id AND m.product_id=p.id AND m.location_id=l.id
        WHERE p.tenant_id=$1 AND ($2::uuid IS NULL OR l.id=$2) ORDER BY l.name,p.name,p.id`,
        [this.tenant, location],
      );
      return result.rows.map((row) => ({
        balance: balanceFromRow(row),
        inventoryState: row.state,
        ...(row.minimum === null
          ? {}
          : { minimumStock: quantity(row.unit, BigInt(row.minimum)) }),
        ...(row.suggested === null
          ? {}
          : { suggestedQuantity: quantity(row.unit, BigInt(row.suggested)) }),
        productName: row.product_name,
        sku: row.sku,
        locationName: row.location_name,
        locationCode: row.location_code,
      }));
    });
  }

  run<T>(
    targets: readonly StockTarget[],
    work: (tx: InventoryTransaction) => Promise<T>,
    permission: Permission,
  ): Promise<T> {
    // Snapshot, deduplicate and order UUID identities before any asynchronous work.
    const ordered = [
      ...new Map(
        targets.map((t) => [
          key(t),
          Object.freeze({
            productId: productId(t.productId),
            locationId: inventoryLocationId(t.locationId),
          }),
        ]),
      ).entries(),
    ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return this.transaction(permission, async (client) => {
      const balances = new Map<string, StockBalance>();
      const expected = new Map<string, StockBalance>();
      const pendingTransfers = new Map<string, readonly string[]>();
      const appendedIds = new Set<string>();
      let active = true;
      const assertActive = () => {
        if (!active) throw new Error("Transaction scope expired");
      };
      const current = (target: StockTarget) => {
        assertActive();
        const balance = balances.get(key(target));
        if (!balance) throw new StockBalanceNotFoundError();
        // Preserve instruction UUID casing for domain's exact target comparison.
        return stockBalance({
          ...balance,
          productId: target.productId,
          locationId: target.locationId,
        });
      };
      for (const [lockKey, t] of ordered) {
        await client.query(
          `INSERT INTO retail.stock_balances (tenant_id,product_id,location_id,unit)
          SELECT $1,p.id,$3,p.unit FROM retail.products p JOIN retail.inventory_locations l ON l.tenant_id=p.tenant_id AND l.id=$3 WHERE p.tenant_id=$1 AND p.id=$2
          ON CONFLICT (tenant_id,product_id,location_id) DO NOTHING`,
          [this.tenant, t.productId, t.locationId],
        );
        const rows = await client.query<BalanceRow>(
          "SELECT * FROM retail.lock_balance($1,$2)",
          [t.productId, t.locationId],
        );
        if (rows.rows[0]) balances.set(lockKey, balanceFromRow(rows.rows[0]));
      }
      const reservedCommands = new Map<
        string,
        InventoryMovement["type"] | "count"
      >();
      const reserveCommand: NonNullable<
        InventoryTransaction["reserveCommand"]
      > = async (id, kind) => {
        assertActive();
        await client.query(
          `INSERT INTO retail.inventory_commands(id,tenant_id,kind) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING`,
          [id, this.tenant, kind],
        );
        const stored = await client.query<{ kind: string }>(
          "SELECT kind FROM retail.inventory_commands WHERE id=$1 AND tenant_id=$2",
          [id, this.tenant],
        );
        if (stored.rows[0]?.kind !== kind)
          throw new InventoryIdempotencyConflictError();
        reservedCommands.set(id.toLowerCase(), kind);
      };
      try {
        const result = await work({
          reserveCommand,
          findReconciliation: async (id) => {
            assertActive();
            const result = await client.query<
              BalanceRow & {
                id: string;
                counted: string;
                reason: string;
                status: "no-change" | "adjusted";
                delta: string | null;
              }
            >(
              "SELECT * FROM retail.inventory_counts WHERE tenant_id=$1 AND id=$2",
              [this.tenant, id],
            );
            const row = result.rows[0];
            if (!row) return undefined;
            const balance = balanceFromRow({
              ...row,
              milli_units: row.counted,
            });
            const input: ReconcileInventoryInput = {
              productId: balance.productId,
              locationId: balance.locationId,
              id: inventoryMovementId(row.id),
              counted: balance.quantity,
              reason: inventoryAdjustmentReason(row.reason),
            };
            const outcome: InventoryReconciliationResult =
              row.status === "no-change"
                ? { status: "no-change", balance }
                : {
                    status: "adjusted",
                    balance,
                    movement: createInventoryAdjustment({
                      id: input.id,
                      productId: input.productId,
                      locationId: input.locationId,
                      reason: input.reason,
                      type: "adjustment",
                      delta: quantity(row.unit, BigInt(row.delta ?? "0")),
                    }),
                  };
            return { input, result: outcome };
          },
          saveReconciliation: async (input, result) => {
            assertActive();
            const balance = current(input);
            if (
              balance.quantity.unit !== input.counted.unit ||
              balance.quantity.milliUnits !== input.counted.milliUnits ||
              result.balance.quantity.milliUnits !== balance.quantity.milliUnits
            )
              throw new Error("Count result must match locked balance");
            await client.query(
              `INSERT INTO retail.inventory_counts(id,tenant_id,product_id,location_id,unit,counted,reason,status,delta,movement_id)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [
                input.id,
                this.tenant,
                input.productId,
                input.locationId,
                input.counted.unit,
                bigintParameter(input.counted.milliUnits),
                input.reason,
                result.status,
                result.status === "adjusted"
                  ? bigintParameter(result.movement.delta.milliUnits)
                  : null,
                result.status === "adjusted" ? result.movement.id : null,
              ],
            );
          },
          readBalance: async (target) => current(target),
          findMovement: async (id) => {
            assertActive();
            const result = await client.query<MovementRow>(
              "SELECT * FROM retail.inventory_movements WHERE tenant_id=$1 AND id=$2",
              [this.tenant, id],
            );
            const row = result.rows[0];
            if (!row) return undefined;
            return Object.freeze({
              movement: movementFromRow(row),
              balance: balanceFromRow({
                ...row,
                milli_units: row.balance_after,
              }),
            });
          },
          findTransfer: async (id) => {
            assertActive();
            const result = await client.query<TransferRow>(
              "SELECT * FROM retail.inventory_transfers WHERE tenant_id=$1 AND id=$2",
              [this.tenant, id],
            );
            const row = result.rows[0];
            if (!row) return undefined;
            return Object.freeze({
              transfer: transferFromRow(row),
              result: Object.freeze({
                sourceBalance: balanceFromRow({
                  product_id: row.product_id,
                  location_id: row.source_location_id,
                  unit: row.unit,
                  milli_units: row.source_after,
                }),
                destinationBalance: balanceFromRow({
                  product_id: row.product_id,
                  location_id: row.destination_location_id,
                  unit: row.unit,
                  milli_units: row.destination_after,
                }),
              }),
            });
          },
          appendMovement: async (input) => {
            assertActive();
            // Only this transaction's reserved count may generate its adjustment.
            if (!(
              reservedCommands.get(input.id.toLowerCase()) === "count" &&
              input.type === "adjustment"
            ))
              await reserveCommand(input.id, input.type);
            const movement = validateMovement(input);
            const next = applyInventoryMovement(current(movement), movement);
            const value =
              movement.type === "adjustment"
                ? movement.delta
                : movement.quantity;
            await client.query(
              `INSERT INTO retail.inventory_movements
              (id,tenant_id,product_id,location_id,type,unit,amount,reason,balance_after)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                movement.id,
                this.tenant,
                movement.productId,
                movement.locationId,
                movement.type,
                value.unit,
                bigintParameter(value.milliUnits),
                movement.type === "adjustment" ? movement.reason : null,
                bigintParameter(next.quantity.milliUnits),
              ],
            );
            balances.set(key(movement), next);
            expected.set(key(movement), next);
            appendedIds.add(movement.id.toLowerCase());
          },
          saveBalance: async (input) => {
            assertActive();
            const balance = stockBalance(input);
            const derived = expected.get(key(balance));
            if (
              !derived ||
              derived.quantity.unit !== balance.quantity.unit ||
              derived.quantity.milliUnits !== balance.quantity.milliUnits
            )
              throw new Error("Balance must match an appended ledger movement");
            // SQL trigger already persisted the derived balance atomically.
            expected.delete(key(balance));
          },
          appendTransfer: async (input) => {
            assertActive();
            const transfer = createInventoryTransfer(input);
            const result = applyInventoryTransfer(
              current({
                productId: transfer.productId,
                locationId: transfer.sourceLocationId,
              }),
              current({
                productId: transfer.productId,
                locationId: transfer.destinationLocationId,
              }),
              transfer,
            );
            await client.query(
              `INSERT INTO retail.inventory_transfers
              (id,tenant_id,issue_movement_id,receipt_movement_id,product_id,source_location_id,destination_location_id,unit,milli_units,source_after,destination_after)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
              [
                transfer.id,
                this.tenant,
                transfer.issueMovementId,
                transfer.receiptMovementId,
                transfer.productId,
                transfer.sourceLocationId,
                transfer.destinationLocationId,
                transfer.quantity.unit,
                bigintParameter(transfer.quantity.milliUnits),
                bigintParameter(result.sourceBalance.quantity.milliUnits),
                bigintParameter(result.destinationBalance.quantity.milliUnits),
              ],
            );
            pendingTransfers.set(transfer.id, [
              transfer.issueMovementId.toLowerCase(),
              transfer.receiptMovementId.toLowerCase(),
            ]);
          },
        });
        if (
          expected.size ||
          [...pendingTransfers.values()].some((ids) =>
            ids.some((id) => !appendedIds.has(id)),
          )
        )
          throw new Error("Incomplete inventory transaction");
        return result;
      } finally {
        active = false;
      }
    });
  }
}

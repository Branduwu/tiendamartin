import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import {
  productId,
  productName,
  sku,
  barcode,
  money,
  SaleReturnConflictError,
  quantity,
  createProduct,
  createSaleDraft,
  addSaleProduct,
  inventoryLocationId,
  inventoryLocationCode,
  inventoryLocationName,
  createInventoryLocation,
  inventoryMovementId,
  inventoryTransferId,
  inventoryAdjustmentReason,
  type InventoryTransfer,
} from "@smartretail/domain";
import {
  receiveInventory,
  issueInventory,
  adjustInventory,
  transferInventory,
  reconcileInventory,
  InventoryIdempotencyConflictError,
  PermissionDeniedError,
  updateProduct,
  completeSaleTransaction,
  SaleIdempotencyConflictError,
  SaleNotFoundError,
  SaleQuoteChangedError,
  SuspensionConflictError,
  type SuspensionInput,
  type SaleCheckoutInput,
  type SaleReturnInput,
  ProductNotFoundError,
  CashStateConflictError,
  openCashRegisterShift,
  recordCashMovement,
  closeCashRegisterShift,
  type Permission,
  type InventoryTransaction,
} from "@smartretail/application";
import {
  PostgresInventory,
  PostgresSales,
  PostgresSuspendedSales,
  PostgresCash,
  PostgresSaleReturns,
  DatabaseUniquenessConflictError,
  listTenantMemberships,
  ProductStorageConflictError,
} from "../src/index";

const configPath = process.env.SMARTRETAIL_PG_TEST_CONFIG;
const tenantA = "550e8400-e29b-41d4-a716-446655440001";
const tenantB = "550e8400-e29b-41d4-a716-446655440002";
const ownerUser = "550e8400-e29b-41d4-a716-446655440020";
const clerkUser = "550e8400-e29b-41d4-a716-446655440021";
const adminUser = "550e8400-e29b-41d4-a716-446655440022";
const outsiderUser = "550e8400-e29b-41d4-a716-446655440023";
const product = productId("550e8400-e29b-41d4-a716-446655440010");
const source = inventoryLocationId("550e8400-e29b-41d4-a716-446655440011");
const destination = inventoryLocationId("550e8400-e29b-41d4-a716-446655440012");
const shiftId = "550e8400-e29b-41d4-a716-446655440030";
const key = { productId: product, locationId: source };
const reason = inventoryAdjustmentReason("Physical count");
const receipt = (amount = 10000n) => ({
  ...key,
  id: inventoryMovementId(randomUUID()),
  type: "receipt" as const,
  quantity: quantity("piece", amount),
});
const issue = (amount = 3000n) => ({
  ...key,
  id: inventoryMovementId(randomUUID()),
  type: "issue" as const,
  quantity: quantity("piece", amount),
});
const transfer = (amount = 3000n): InventoryTransfer => ({
  id: inventoryTransferId(randomUUID()),
  issueMovementId: inventoryMovementId(randomUUID()),
  receiptMovementId: inventoryMovementId(randomUUID()),
  productId: product,
  sourceLocationId: source,
  destinationLocationId: destination,
  quantity: quantity("piece", amount),
});

// Explicit disposable local database only. Never read a normal DATABASE_URL.
describe.skipIf(!configPath)("PostgreSQL inventory integration", () => {
  let admin: Pool;
  let pool: Pool;
  let apiPool: Pool;
  let db: PostgresInventory;
  let other: PostgresInventory;
  async function sql<T>(
    tenant: string | undefined,
    work: (client: PoolClient) => Promise<T>,
    user: string | null = ownerUser,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (user !== null)
        await client.query("SELECT set_config('app.user_id',$1,true)", [user]);
      if (tenant !== undefined)
        await client.query("SELECT set_config('app.tenant_id',$1,true)", [
          tenant,
        ]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async function stock(location = source): Promise<bigint | undefined> {
    return db.run(
      [{ productId: product, locationId: location }],
      async (tx) =>
        (await tx.readBalance({ productId: product, locationId: location }))
          ?.quantity.milliUnits,
      "inventory.read",
    );
  }
  const fixtureProduct = (
    id = product,
    code = "SKU-1",
    codebar: string | null = "123",
  ) =>
    createProduct({
      id,
      name: productName("Producto"),
      sku: sku(code),
      ...(codebar === null ? {} : { barcode: barcode(codebar) }),
      unit: "piece",
      purchaseCost: money(1250n),
      salePrice: money(2000n),
      status: "active",
    });
  beforeAll(async () => {
    if (!configPath)
      throw new Error("Missing disposable database configuration");
    const config: {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
      appUser: string;
      appPassword: string;
    } = JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
    if (
      config.host !== "127.0.0.1" ||
      config.database !== "smartretail_task010" ||
      config.appUser !== "smartretail_test_login"
    )
      throw new Error("Tests require the dedicated disposable local database");
    admin = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: 2,
    });
    const existing = await admin.query<{ exists: boolean }>(
      "SELECT to_regclass('retail.tenants') IS NOT NULL AS exists",
    );
    if (!existing.rows[0]?.exists) {
      await admin.query(
        await readFile(
          new URL("../migrations/001_inventory.sql", import.meta.url),
          "utf8",
        ),
      );
      const role = await admin.query<{ command: string }>(
        "SELECT format('CREATE ROLE smartretail_test_login LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L IN ROLE smartretail_app',$1::text) AS command",
        [config.appPassword],
      );
      const command = role.rows[0]?.command;
      if (!command) throw new Error("Missing role provisioning command");
      await admin.query(command);
    }
    const membershipMigration = await admin.query<{ exists: boolean }>(
      "SELECT to_regclass('retail.tenant_memberships') IS NOT NULL AS exists",
    );
    if (!membershipMigration.rows[0]?.exists)
      await admin.query(
        await readFile(
          new URL("../migrations/002_memberships.sql", import.meta.url),
          "utf8",
        ),
      );
    const productWebMigration = await admin.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='retail' AND tablename='products' AND policyname='product_update') AS exists",
    );
    if (!productWebMigration.rows[0]?.exists)
      await admin.query(
        await readFile(
          new URL("../migrations/003_product_web.sql", import.meta.url),
          "utf8",
        ),
      );
    const countMigration = await admin.query<{ exists: boolean }>(
      "SELECT to_regclass('retail.inventory_counts') IS NOT NULL AS exists",
    );
    if (!countMigration.rows[0]?.exists)
      await admin.query(
        await readFile(
          new URL("../migrations/004_inventory_counts.sql", import.meta.url),
          "utf8",
        ),
      );
    const apiRole = await admin.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='smartretail_api') AS exists",
    );
    if (!apiRole.rows[0]?.exists)
      await admin.query(
        await readFile(
          new URL("../migrations/005_runtime_api.sql", import.meta.url),
          "utf8",
        ),
      );
    const saleMigration = await admin.query<{ exists: boolean }>(
      "SELECT to_regclass('retail.sales') IS NOT NULL AS exists",
    );
    if (!saleMigration.rows[0]?.exists)
      await admin.query(
        await readFile(
          new URL("../migrations/006_sales.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.cash_register_shifts') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/007_cash.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.suspended_sales') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/008_suspended_sales.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.sale_returns') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/009_sale_returns.sql", import.meta.url),
          "utf8",
        ),
      );
    const provision = await admin.query<{ command: string }>(
      "SELECT format('ALTER ROLE smartretail_api LOGIN PASSWORD %L',$1::text) AS command",
      [config.appPassword],
    );
    if (!provision.rows[0])
      throw new Error("Missing ephemeral runtime provisioning");
    await admin.query(provision.rows[0].command);
    apiPool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: "smartretail_api",
      password: config.appPassword,
      max: 1,
    });
    pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.appUser,
      password: config.appPassword,
      max: 8,
    });
    db = new PostgresInventory(pool, { tenantId: tenantA, userId: ownerUser });
    other = new PostgresInventory(pool, {
      tenantId: tenantB,
      userId: ownerUser,
    });
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    await apiPool?.end();
    await admin?.end();
  });
  beforeEach(async () => {
    await admin.query(
      "TRUNCATE retail.sale_return_refunds,retail.sale_return_lines,retail.sale_returns,retail.suspended_sale_lines,retail.suspended_sales,retail.cash_movements,retail.cash_register_shifts,retail.sale_payments,retail.sale_lines,retail.sales,retail.inventory_counts,retail.inventory_commands,retail.inventory_transfers,retail.inventory_movements,retail.stock_balances,retail.inventory_locations,retail.products,retail.tenant_memberships,retail.tenants",
    );
    await admin.query(
      "INSERT INTO retail.tenants(tenant_id) VALUES ($1),($2)",
      [tenantA, tenantB],
    );
    await admin.query(
      `INSERT INTO retail.tenant_memberships(tenant_id,user_id,role,status)
      VALUES ($1,$3,'owner','active'),($2,$3,'owner','active'),($1,$4,'inventory_clerk','active'),($1,$5,'admin','active')`,
      [tenantA, tenantB, ownerUser, clerkUser, adminUser],
    );
    for (const adapter of [db, other]) {
      await adapter.createProduct(fixtureProduct());
      for (const id of [source, destination])
        await adapter.createLocation(
          createInventoryLocation({
            id,
            code: inventoryLocationCode(id === source ? "MAIN" : "DEST"),
            name: inventoryLocationName("Almacén"),
            status: "active",
          }),
        );
    }
    await new PostgresCash(apiPool, {
      tenantId: tenantA,
      userId: ownerUser,
    }).openShift({ id: shiftId, locationId: source, openingCash: money(0n) });
    await receiveInventory(db, receipt());
  });

  describe("transactional sale returns", () => {
    const repo = (userId = ownerUser, tenantId = tenantA) =>
      new PostgresSaleReturns(pool, { userId, tenantId });
    async function sold(
      method: "cash" | "card" | "mixed" = "mixed",
      amount = 5000n,
    ) {
      const draft = addSaleProduct(
        createSaleDraft(randomUUID()),
        fixtureProduct(),
        quantity("piece", amount),
      );
      const total = draft.total.minorUnits;
      const payments =
        method === "mixed"
          ? [
              { method: "cash" as const, amount: money((total * 3n) / 5n) },
              { method: "card" as const, amount: money((total * 2n) / 5n) },
            ]
          : [{ method, amount: draft.total }];
      return (
        await completeSaleTransaction(repo(), {
          shiftId,
          draft,
          locationId: source,
          payments,
          movements: [{ productId: product, movementId: randomUUID() }],
        })
      ).recorded;
    }
    const command = (
      amount = 1000n,
      method: "cash" | "card" = "cash",
    ): SaleReturnInput => ({
      id: randomUUID(),
      ...(method === "cash" ? { shiftId, cashMovementId: randomUUID() } : {}),
      lines: [
        {
          saleLineId: product,
          productId: product,
          quantity: quantity("piece", amount),
          movementId: randomUUID(),
        },
      ],
      refunds: [{ method, amount: money(amount * 2n) }],
    });
    const count = async () =>
      (
        await admin.query(
          "SELECT (SELECT count(*) FROM retail.sale_returns)::text returns,(SELECT count(*) FROM retail.inventory_movements WHERE sale_return_id IS NOT NULL)::text receipts,(SELECT count(*) FROM retail.cash_movements WHERE sale_return_id IS NOT NULL)::text cash",
        )
      ).rows[0];
    const expected = async () =>
      (
        await new PostgresCash(pool, {
          userId: ownerUser,
          tenantId: tenantA,
        }).currentShift(source)
      )?.expectedCash.minorUnits;
    it("full mixed return restores stock and cash with the original sale immutable", async () => {
      const original = await sold();
      const c = command(5000n);
      const result = await repo().returnSale(original.sale.id, {
        ...c,
        refunds: original.payments,
      });
      expect(result.record.total.minorUnits).toBe(10000n);
      expect(await stock()).toBe(10000n);
      expect(await expected()).toBe(0n);
      expect(await repo().readSale(original.sale.id)).toEqual(original);
      expect(await count()).toEqual({ returns: "1", receipts: "1", cash: "1" });
    });
    it("partial and second return add receipts without modifying original issue", async () => {
      const original = await sold();
      await repo().returnSale(original.sale.id, command());
      await repo().returnSale(original.sale.id, command(2000n));
      expect(await stock()).toBe(8000n);
      expect(await expected()).toBe(0n);
      expect(await repo().listReturns(original.sale.id)).toHaveLength(2);
      expect(
        (
          await admin.query(
            "SELECT count(*) FROM retail.inventory_movements WHERE sale_id=$1 AND type='issue'",
            [original.sale.id],
          )
        ).rows[0]?.count,
      ).toBe("1");
    });
    it("rejects over-return after previous returns with no extra receipts", async () => {
      const original = await sold("cash");
      await repo().returnSale(original.sale.id, command(4000n));
      await expect(
        repo().returnSale(original.sale.id, command(2000n)),
      ).rejects.toBeInstanceOf(SaleReturnConflictError);
      expect(await stock()).toBe(9000n);
      expect((await count()).returns).toBe("1");
    });
    it("inactive product remains returnable", async () => {
      const original = await sold();
      await updateProduct(db, product, { status: "inactive" });
      expect(
        (await repo().returnSale(original.sale.id, command())).record.total
          .minorUnits,
      ).toBe(2000n);
      expect(await stock()).toBe(6000n);
    });
    it("changed current price does not affect historical refund", async () => {
      const original = await sold();
      await updateProduct(db, product, { salePrice: money(9999n) });
      expect(
        (await repo().returnSale(original.sale.id, command())).record.total
          .minorUnits,
      ).toBe(2000n);
    });
    it("card return after shift closure has no physical cash ledger", async () => {
      const original = await sold("card");
      await closeCashRegisterShift(
        new PostgresCash(pool, { userId: ownerUser, tenantId: tenantA }),
        shiftId,
        money(0n),
      );
      expect(
        (await repo().returnSale(original.sale.id, command(5000n, "card")))
          .record.shiftId,
      ).toBeNull();
      expect(await stock()).toBe(10000n);
      expect((await count()).cash).toBe("0");
    });
    it("cash refund reduces expected cash exactly", async () => {
      const original = await sold("cash");
      await repo().returnSale(original.sale.id, command());
      expect(await expected()).toBe(8000n);
      expect((await count()).cash).toBe("1");
    });
    it("mixed refund only affects its cash component", async () => {
      const original = await sold();
      const c = command(2000n);
      await repo().returnSale(original.sale.id, {
        ...c,
        refunds: [
          { method: "cash", amount: money(1000n) },
          { method: "card", amount: money(3000n) },
        ],
      });
      expect(await expected()).toBe(5000n);
    });
    it("refund method totals cannot exceed originally paid cash", async () => {
      const original = await sold();
      await repo().returnSale(original.sale.id, command(3000n));
      await expect(
        repo().returnSale(original.sale.id, command()),
      ).rejects.toBeInstanceOf(SaleReturnConflictError);
      expect(await stock()).toBe(8000n);
    });
    it("a cash-only original cannot be refunded to card", async () => {
      const original = await sold("cash");
      await expect(
        repo().returnSale(original.sale.id, command(1000n, "card")),
      ).rejects.toBeInstanceOf(SaleReturnConflictError);
      expect((await count()).returns).toBe("0");
    });
    it("rejects client refund total differing from the snapshot", async () => {
      const original = await sold();
      await expect(
        repo().returnSale(original.sale.id, {
          ...command(),
          refunds: [{ method: "cash", amount: money(1n) }],
        }),
      ).rejects.toBeInstanceOf(TypeError);
      expect(await stock()).toBe(5000n);
    });
    it("cash without shift or after closure rolls back fully", async () => {
      const original = await sold("cash");
      const c = command();
      await expect(
        repo().returnSale(original.sale.id, {
          id: c.id,
          lines: c.lines,
          refunds: c.refunds,
        }),
      ).rejects.toBeInstanceOf(CashStateConflictError);
      await closeCashRegisterShift(
        new PostgresCash(pool, { userId: ownerUser, tenantId: tenantA }),
        shiftId,
        money(10000n),
      );
      await expect(
        repo().returnSale(original.sale.id, c),
      ).rejects.toBeInstanceOf(SaleReturnConflictError);
      expect(await stock()).toBe(5000n);
      expect((await count()).returns).toBe("0");
    });
    it("cash cannot refund against insufficient theoretical funds", async () => {
      const original = await sold("cash");
      await recordCashMovement(
        new PostgresCash(pool, { userId: ownerUser, tenantId: tenantA }),
        {
          id: randomUUID(),
          shiftId,
          type: "cash_out",
          amount: money(10000n),
          reason: "Fixture withdrawal",
        },
      );
      await expect(
        repo().returnSale(original.sale.id, command()),
      ).rejects.toBeInstanceOf(CashStateConflictError);
      expect(await stock()).toBe(5000n);
      expect(await expected()).toBe(0n);
    });
    it("cash from another location is rejected before stock writes", async () => {
      const original = await sold();
      const otherShift = await openCashRegisterShift(
        new PostgresCash(pool, { userId: ownerUser, tenantId: tenantA }),
        {
          id: randomUUID(),
          locationId: destination,
          openingCash: money(10000n),
        },
      );
      await expect(
        repo().returnSale(original.sale.id, {
          ...command(),
          shiftId: otherShift.id,
        }),
      ).rejects.toBeInstanceOf(CashStateConflictError);
      expect((await count()).returns).toBe("0");
    });
    it("stable retry after closing the shift changes neither stock nor cash", async () => {
      const original = await sold("cash");
      const c = command();
      await repo().returnSale(original.sale.id, c);
      await closeCashRegisterShift(
        new PostgresCash(pool, { userId: ownerUser, tenantId: tenantA }),
        shiftId,
        money(8000n),
      );
      expect((await repo().returnSale(original.sale.id, c)).replayed).toBe(
        true,
      );
      expect(await stock()).toBe(6000n);
      expect(await expected()).toBe(8000n);
    });
    it("same return ID with different payload conflicts", async () => {
      const original = await sold();
      const c = command();
      await repo().returnSale(original.sale.id, c);
      await expect(
        repo().returnSale(original.sale.id, {
          ...c,
          lines: command(2000n).lines,
          refunds: [{ method: "cash", amount: money(4000n) }],
        }),
      ).rejects.toBeInstanceOf(SaleReturnConflictError);
    });
    it("concurrent requests cannot return the final quantity twice", async () => {
      const original = await sold("cash", 1000n);
      const results = await Promise.allSettled([
        repo().returnSale(original.sale.id, command()),
        repo().returnSale(original.sale.id, command()),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await stock()).toBe(10000n);
      expect(await expected()).toBe(0n);
    });
    it("concurrent identical ID yields one receipt and one cash movement", async () => {
      const original = await sold();
      const c = command();
      const result = await Promise.all([
        repo().returnSale(original.sale.id, c),
        repo().returnSale(original.sale.id, c),
      ]);
      expect(result.map((r) => r.replayed).sort()).toEqual([false, true]);
      expect(await count()).toEqual({ returns: "1", receipts: "1", cash: "1" });
    });
    it("movement failure rolls back the return, cash and stock", async () => {
      const original = await sold();
      const c = command();
      const movement = (
        await admin.query(
          "SELECT movement_id FROM retail.sale_lines WHERE sale_id=$1",
          [original.sale.id],
        )
      ).rows[0]?.movement_id;
      await expect(
        repo().returnSale(original.sale.id, {
          ...c,
          lines: [{ ...c.lines[0]!, movementId: movement }],
        }),
      ).rejects.toBeInstanceOf(SaleReturnConflictError);
      expect(await count()).toEqual({ returns: "0", receipts: "0", cash: "0" });
      expect(await stock()).toBe(5000n);
      expect(await expected()).toBe(6000n);
    });
    it("cash insert failure after receipts rolls everything back", async () => {
      const original = await sold();
      const cashId = randomUUID();
      await recordCashMovement(
        new PostgresCash(pool, { userId: ownerUser, tenantId: tenantA }),
        {
          id: cashId,
          shiftId,
          type: "cash_in",
          amount: money(1n),
          reason: "Fixture income",
        },
      );
      await expect(
        repo().returnSale(original.sale.id, {
          ...command(),
          cashMovementId: cashId,
        }),
      ).rejects.toBeInstanceOf(SaleReturnConflictError);
      expect(await count()).toEqual({ returns: "0", receipts: "0", cash: "0" });
      expect(await stock()).toBe(5000n);
      expect(await expected()).toBe(6001n);
    });
    it("another sale cannot use a completed return ID", async () => {
      const original = await sold(),
        second = await sold();
      const c = command();
      await repo().returnSale(original.sale.id, c);
      await expect(repo().returnSale(second.sale.id, c)).rejects.toBeInstanceOf(
        SaleReturnConflictError,
      );
    });
    it("rejects a product/line from another original sale", async () => {
      const original = await sold();
      const p = fixtureProduct(productId(randomUUID()), "OTHER-SALE", null);
      await db.createProduct(p);
      const c = command();
      await expect(
        repo().returnSale(original.sale.id, {
          ...c,
          lines: [{ ...c.lines[0]!, saleLineId: p.id, productId: p.id }],
        }),
      ).rejects.toBeInstanceOf(SaleReturnConflictError);
    });
    it("tenant outsider and clerk are denied while company admin may return", async () => {
      const original = await sold();
      await expect(
        repo(clerkUser).returnSale(original.sale.id, command()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        repo(outsiderUser).listReturns(original.sale.id),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      expect(
        (await repo(adminUser).returnSale(original.sale.id, command())).record
          .createdBy,
      ).toBe(adminUser);
    });
    it("cross-tenant originals cannot be returned, read or replayed", async () => {
      const original = await sold();
      const c = command();
      await repo().returnSale(original.sale.id, c);
      await expect(
        repo(ownerUser, tenantB).returnSale(original.sale.id, c),
      ).rejects.toBeInstanceOf(SaleNotFoundError);
      await expect(
        repo(ownerUser, tenantB).listReturns(original.sale.id),
      ).rejects.toBeInstanceOf(SaleNotFoundError);
    });
    it("runtime cannot update historical return or append a later refund", async () => {
      const original = await sold();
      const result = await repo().returnSale(original.sale.id, command());
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "UPDATE retail.sale_returns SET total_minor_units=1 WHERE id=$1",
            [result.record.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "INSERT INTO retail.sale_return_refunds VALUES($1,$2,$3,'card',1)",
            [tenantA, result.record.id, original.sale.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("incomplete return cannot commit and all new tables FORCE RLS", async () => {
      const original = await sold();
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "INSERT INTO retail.sale_returns(id,tenant_id,sale_id,location_id,created_by,total_minor_units,cash_refund_minor_units,command_payload) VALUES($1,$2,$3,$4,$5,0,0,'fixture')",
            [randomUUID(), tenantA, original.sale.id, source, ownerUser],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      const flags = (
        await admin.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('retail.sale_returns'::regclass,'retail.sale_return_lines'::regclass,'retail.sale_return_refunds'::regclass)",
        )
      ).rows;
      expect(flags).toHaveLength(3);
      expect(
        flags.every((r) => r.relrowsecurity && r.relforcerowsecurity),
      ).toBe(true);
    });
  });

  describe("suspended sales and exact barcode", () => {
    const repo = (userId = ownerUser, tenantId = tenantA) =>
      new PostgresSuspendedSales(pool, { userId, tenantId });
    const suspendedCommand = (amount = 1000n): SuspensionInput => ({
      id: randomUUID(),
      locationId: source,
      lines: [{ productId: product, quantity: quantity("piece", amount) }],
    });
    const checkout = (id: string, amount = 1000n): SaleCheckoutInput => {
      const draft = addSaleProduct(
        createSaleDraft(randomUUID()),
        fixtureProduct(),
        quantity("piece", amount),
      );
      return {
        suspendedSaleId: id,
        shiftId,
        draft,
        locationId: source,
        payments: [{ method: "cash", amount: draft.total }],
        movements: [{ productId: product, movementId: randomUUID() }],
      };
    };
    const status = async (id: string) =>
      (
        await admin.query(
          "SELECT status FROM retail.suspended_sales WHERE id=$1",
          [id],
        )
      ).rows[0]?.status;
    it("looks up an exact active barcode and rejects prefix matching", async () => {
      expect((await repo().lookupBarcode("123"))?.id).toBe(product);
      expect(await repo().lookupBarcode("12")).toBeUndefined();
    });
    it("returns inactive product distinctly without changing stock", async () => {
      await updateProduct(db, product, { status: "inactive" });
      expect((await repo().lookupBarcode("123"))?.status).toBe("inactive");
      expect(await stock()).toBe(10000n);
    });
    it("cannot look up another tenant barcode", async () => {
      await other.createProduct(
        fixtureProduct(productId(randomUUID()), "FOREIGN", "FOREIGN-123"),
      );
      expect(await repo().lookupBarcode("FOREIGN-123")).toBeUndefined();
    });
    it("suspends without sales/payments/reservations/stock movement", async () => {
      const result = await repo().suspend(suspendedCommand(5000n));
      expect(result.record.status).toBe("suspended");
      expect(await stock()).toBe(10000n);
      expect(
        (await admin.query("SELECT count(*) FROM retail.sales")).rows[0]?.count,
      ).toBe("0");
      expect(
        (await admin.query("SELECT count(*) FROM retail.sale_payments")).rows[0]
          ?.count,
      ).toBe("0");
      expect(
        (await admin.query("SELECT count(*) FROM retail.inventory_movements"))
          .rows[0]?.count,
      ).toBe("1");
    });
    it("replays identical ID after reload and rejects changed quantities", async () => {
      const command = suspendedCommand();
      await repo().suspend(command);
      expect((await repo().suspend(command)).replayed).toBe(true);
      await expect(
        repo().suspend({
          ...command,
          lines: [{ productId: product, quantity: quantity("piece", 2000n) }],
        }),
      ).rejects.toBeInstanceOf(SuspensionConflictError);
      expect((await repo().listSuspended()).length).toBe(1);
    });
    it("serializes concurrent same-ID suspension", async () => {
      const command = suspendedCommand();
      const results = await Promise.all([
        repo().suspend(command),
        repo().suspend(command),
      ]);
      expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    });
    it("suspends without open shift and survives closure", async () => {
      await closeCashRegisterShift(
        new PostgresCash(pool, { userId: ownerUser, tenantId: tenantA }),
        shiftId,
        money(0n),
      );
      const result = await repo().suspend(suspendedCommand());
      expect(
        (await repo().recoverSuspended(result.record.id, randomUUID())).draft
          .lines,
      ).toHaveLength(1);
    });
    it("rejects inactive location and inactive product without storing partial cart", async () => {
      await updateProduct(db, product, { status: "inactive" });
      await expect(repo().suspend(suspendedCommand())).rejects.toBeInstanceOf(
        SuspensionConflictError,
      );
      await admin.query(
        "UPDATE retail.inventory_locations SET status='inactive' WHERE tenant_id=$1 AND id=$2",
        [tenantA, source],
      );
      await expect(repo().suspend(suspendedCommand())).rejects.toBeInstanceOf(
        Error,
      );
      expect(await repo().listSuspended()).toHaveLength(0);
    });
    it("recovers current price and retains the suspension", async () => {
      const result = await repo().suspend(suspendedCommand());
      await updateProduct(db, product, { salePrice: money(3333n) });
      const restored = await repo().recoverSuspended(
        result.record.id,
        randomUUID(),
      );
      expect(restored.draft.total.minorUnits).toBe(3333n);
      expect(await status(result.record.id)).toBe("suspended");
      expect(await stock()).toBe(10000n);
    });
    it("blocks newly inactive product while retaining original cart", async () => {
      const result = await repo().suspend(suspendedCommand());
      await updateProduct(db, product, { status: "inactive" });
      await expect(
        repo().recoverSuspended(result.record.id, randomUUID()),
      ).rejects.toBeInstanceOf(SuspensionConflictError);
      expect(await status(result.record.id)).toBe("suspended");
    });
    it("blocks changed unit rather than reinterpreting quantity", async () => {
      const p = fixtureProduct(productId(randomUUID()), "UNSTOCKED", null);
      await db.createProduct(p);
      const result = await repo().suspend({
        id: randomUUID(),
        locationId: source,
        lines: [{ productId: p.id, quantity: quantity("piece", 2000n) }],
      });
      await updateProduct(db, p.id, { unit: "kg" });
      await expect(
        repo().recoverSuspended(result.record.id, randomUUID()),
      ).rejects.toBeInstanceOf(SuspensionConflictError);
      expect(await status(result.record.id)).toBe("suspended");
    });
    it("does not reserve stock; reduced stock rejects checkout with full rollback", async () => {
      const result = await repo().suspend(suspendedCommand(5000n));
      await issueInventory(db, issue(8000n));
      expect(
        (await repo().recoverSuspended(result.record.id, randomUUID())).draft
          .lines[0]?.quantity.milliUnits,
      ).toBe(5000n);
      await expect(
        completeSaleTransaction(repo(), checkout(result.record.id, 5000n)),
      ).rejects.toBeInstanceOf(Error);
      expect(await stock()).toBe(2000n);
      expect(await status(result.record.id)).toBe("suspended");
      expect(
        (await admin.query("SELECT count(*) FROM retail.sales")).rows[0]?.count,
      ).toBe("0");
    });
    it("cancel retains rows, is retryable and removes pending without financial effect", async () => {
      const result = await repo().suspend(suspendedCommand());
      expect((await repo().cancelSuspended(result.record.id)).status).toBe(
        "cancelled",
      );
      expect((await repo().cancelSuspended(result.record.id)).status).toBe(
        "cancelled",
      );
      expect(await repo().listSuspended()).toHaveLength(0);
      expect(await stock()).toBe(10000n);
      expect(
        (await admin.query("SELECT count(*) FROM retail.suspended_sale_lines"))
          .rows[0]?.count,
      ).toBe("1");
    });
    it("cancelled cannot recover or complete", async () => {
      const result = await repo().suspend(suspendedCommand());
      await repo().cancelSuspended(result.record.id);
      await expect(
        repo().recoverSuspended(result.record.id, randomUUID()),
      ).rejects.toBeInstanceOf(SuspensionConflictError);
      await expect(
        completeSaleTransaction(repo(), checkout(result.record.id)),
      ).rejects.toBeInstanceOf(SuspensionConflictError);
      expect(await stock()).toBe(10000n);
    });
    it("completes atomically, replays original SaleId and rejects a different sale", async () => {
      const result = await repo().suspend(suspendedCommand());
      const command = checkout(result.record.id);
      const completed = await completeSaleTransaction(repo(), command);
      expect(completed.replayed).toBe(false);
      expect(await status(result.record.id)).toBe("completed");
      expect(await stock()).toBe(9000n);
      expect((await completeSaleTransaction(repo(), command)).replayed).toBe(
        true,
      );
      await expect(
        completeSaleTransaction(repo(), checkout(result.record.id)),
      ).rejects.toBeInstanceOf(SuspensionConflictError);
      await expect(
        repo().cancelSuspended(result.record.id),
      ).rejects.toBeInstanceOf(SuspensionConflictError);
      expect(await stock()).toBe(9000n);
    });
    it("serializes two checkout IDs for one suspended sale", async () => {
      const result = await repo().suspend(suspendedCommand());
      const results = await Promise.allSettled([
        completeSaleTransaction(repo(), checkout(result.record.id)),
        completeSaleTransaction(repo(), checkout(result.record.id)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await stock()).toBe(9000n);
    });
    it("serializes cancellation versus checkout", async () => {
      const result = await repo().suspend(suspendedCommand());
      const results = await Promise.allSettled([
        completeSaleTransaction(repo(), checkout(result.record.id)),
        repo().cancelSuspended(result.record.id),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await stock()).toBe(
        (await status(result.record.id)) === "completed" ? 9000n : 10000n,
      );
    });
    it("rejects forged price, retaining suspension and balances", async () => {
      const result = await repo().suspend(suspendedCommand());
      const command = checkout(result.record.id);
      await updateProduct(db, product, { salePrice: money(9999n) });
      await expect(
        completeSaleTransaction(repo(), command),
      ).rejects.toBeInstanceOf(SaleQuoteChangedError);
      expect(await status(result.record.id)).toBe("suspended");
      expect(await stock()).toBe(10000n);
    });
    it("denies tenant outsider and clerk but permits company admin", async () => {
      const result = await repo().suspend(suspendedCommand());
      await expect(repo(outsiderUser).listSuspended()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(
        repo(clerkUser).suspend(suspendedCommand()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        repo(clerkUser).recoverSuspended(result.record.id, randomUUID()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      expect(
        (await repo(adminUser).recoverSuspended(result.record.id, randomUUID()))
          .record.createdBy,
      ).toBe(ownerUser);
    });
    it("another tenant cannot see, recover, cancel or attach suspension", async () => {
      const result = await repo().suspend(suspendedCommand());
      expect(await repo(ownerUser, tenantB).listSuspended()).toHaveLength(0);
      await expect(
        repo(ownerUser, tenantB).recoverSuspended(
          result.record.id,
          randomUUID(),
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        repo(ownerUser, tenantB).cancelSuspended(result.record.id),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        completeSaleTransaction(
          repo(ownerUser, tenantB),
          checkout(result.record.id),
        ),
      ).rejects.toBeInstanceOf(SuspensionConflictError);
      expect(await status(result.record.id)).toBe("suspended");
    });
    it("runtime cannot update/delete lifecycle or append historic lines", async () => {
      const result = await repo().suspend(suspendedCommand());
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "UPDATE retail.suspended_sales SET status='cancelled' WHERE id=$1",
            [result.record.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        sql(tenantA, (c) =>
          c.query("DELETE FROM retail.suspended_sales WHERE id=$1", [
            result.record.id,
          ]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      const p = fixtureProduct(productId(randomUUID()), "EXTRA", null);
      await db.createProduct(p);
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "INSERT INTO retail.suspended_sale_lines VALUES($1,$2,$3,'piece',1000)",
            [tenantA, result.record.id, p.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("enforces FORCE RLS and same-tenant location association", async () => {
      const rows = await admin.query(
        "SELECT relforcerowsecurity,relrowsecurity FROM pg_class WHERE oid IN ('retail.suspended_sales'::regclass,'retail.suspended_sale_lines'::regclass)",
      );
      expect(rows.rows).toEqual([
        { relforcerowsecurity: true, relrowsecurity: true },
        { relforcerowsecurity: true, relrowsecurity: true },
      ]);
      const result = await repo().suspend(suspendedCommand());
      await expect(
        completeSaleTransaction(repo(), {
          ...checkout(result.record.id),
          locationId: destination,
        }),
      ).rejects.toBeInstanceOf(SuspensionConflictError);
    });
  });

  describe("transactional sales", () => {
    const sales = () =>
      new PostgresSales(apiPool, { tenantId: tenantA, userId: ownerUser });
    const command = (amount = 1000n): SaleCheckoutInput => {
      const draft = addSaleProduct(
        createSaleDraft(randomUUID()),
        fixtureProduct(),
        quantity("piece", amount),
      );
      return {
        shiftId,
        draft,
        locationId: source,
        payments: [{ method: "cash", amount: draft.total }],
        movements: [{ productId: product, movementId: randomUUID() }],
      };
    };
    const counts = async () =>
      (
        await admin.query<{
          sales: string;
          lines: string;
          payments: string;
          movements: string;
        }>(`SELECT (SELECT count(*) FROM retail.sales)::text sales,
      (SELECT count(*) FROM retail.sale_lines)::text lines,(SELECT count(*) FROM retail.sale_payments)::text payments,
      (SELECT count(*) FROM retail.inventory_movements WHERE sale_id IS NOT NULL)::text movements`)
      ).rows[0];
    it.each(["cash", "card", "mixed"] as const)(
      "persists %s and one atomic issue",
      async (method) => {
        const c = command();
        const payments =
          method === "mixed"
            ? [
                { method: "cash" as const, amount: money(700n) },
                { method: "card" as const, amount: money(1300n) },
              ]
            : [{ method, amount: c.draft.total }];
        const result = await completeSaleTransaction(sales(), {
          ...c,
          payments,
        });
        expect(result.replayed).toBe(false);
        expect(result.recorded.sale.status).toBe("completed");
        expect(await stock()).toBe(9000n);
        expect(await counts()).toEqual({
          sales: "1",
          lines: "1",
          payments: method === "mixed" ? "2" : "1",
          movements: "1",
        });
      },
    );
    it("rejects underpayment without writing or changing stock", async () => {
      const c = command();
      await expect(
        completeSaleTransaction(sales(), {
          ...c,
          payments: [{ method: "cash", amount: money(1n) }],
        }),
      ).rejects.toThrow();
      expect(await stock()).toBe(10000n);
      expect((await counts())?.sales).toBe("0");
    });
    it("rejects inactive product from authoritative store", async () => {
      const c = command();
      await db.editProduct(product, (p) => ({ ...p, status: "inactive" }));
      await expect(completeSaleTransaction(sales(), c)).rejects.toThrow();
      expect(await stock()).toBe(10000n);
    });
    it("does not trust client price and total, even when internally consistent", async () => {
      const c = command();
      const fake = addSaleProduct(
        createSaleDraft(c.draft.id),
        createProduct({ ...fixtureProduct(), salePrice: money(1n) }),
        quantity("piece", 1000n),
      );
      await expect(
        completeSaleTransaction(sales(), {
          ...c,
          draft: fake,
          payments: [{ method: "cash", amount: fake.total }],
        }),
      ).rejects.toBeInstanceOf(SaleQuoteChangedError);
      expect((await counts())?.sales).toBe("0");
    });
    it("rejects insufficient stock atomically", async () => {
      await expect(
        completeSaleTransaction(sales(), command(11000n)),
      ).rejects.toThrow();
      expect(await stock()).toBe(10000n);
      expect((await counts())?.movements).toBe("0");
    });
    it("replay returns historical sale without a second issue after product changes", async () => {
      const c = command();
      const first = await completeSaleTransaction(sales(), c);
      await db.editProduct(product, (p) => ({
        ...p,
        name: productName("Cambiado"),
        salePrice: money(9999n),
        status: "inactive",
      }));
      const retry = await completeSaleTransaction(sales(), c);
      expect(retry.replayed).toBe(true);
      expect(retry.recorded).toEqual(first.recorded);
      expect(await stock()).toBe(9000n);
    });
    it("same SaleId and different quantity conflicts", async () => {
      const c = command();
      await completeSaleTransaction(sales(), c);
      const draft = addSaleProduct(
        createSaleDraft(c.draft.id),
        fixtureProduct(),
        quantity("piece", 2000n),
      );
      await expect(
        completeSaleTransaction(sales(), {
          ...c,
          draft,
          payments: [{ method: "cash", amount: draft.total }],
        }),
      ).rejects.toBeInstanceOf(SaleIdempotencyConflictError);
      expect(await stock()).toBe(9000n);
    });
    it("simultaneous retry completes once", async () => {
      const c = command();
      const results = await Promise.all([
        completeSaleTransaction(sales(), c),
        completeSaleTransaction(sales(), c),
      ]);
      expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
      expect(await stock()).toBe(9000n);
      expect((await counts())?.sales).toBe("1");
    });
    it("two concurrent sales cannot overspend shared stock", async () => {
      const results = await Promise.allSettled([
        completeSaleTransaction(sales(), command(6000n)),
        completeSaleTransaction(sales(), command(6000n)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await stock()).toBe(4000n);
      expect((await counts())?.sales).toBe("1");
    });
    it("second line failure rolls back first line ledger and all sale rows", async () => {
      const second = createProduct({
        ...fixtureProduct(),
        id: productId("550e8400-e29b-41d4-a716-446655440099"),
        sku: sku("SECOND"),
        barcode: barcode("999"),
      });
      await db.createProduct(second);
      const c = command();
      const draft = addSaleProduct(c.draft, second, quantity("piece", 1000n));
      await expect(
        completeSaleTransaction(sales(), {
          ...c,
          draft,
          payments: [{ method: "cash", amount: draft.total }],
          movements: [
            ...c.movements,
            { productId: second.id, movementId: randomUUID() },
          ],
        }),
      ).rejects.toThrow();
      expect(await stock()).toBe(10000n);
      expect(await counts()).toEqual({
        sales: "0",
        lines: "0",
        payments: "0",
        movements: "0",
      });
    });
    it("inventory clerk is denied sale creation and read", async () => {
      const clerk = new PostgresSales(apiPool, {
        tenantId: tenantA,
        userId: clerkUser,
      });
      await expect(
        completeSaleTransaction(clerk, command()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(clerk.readSale(randomUUID())).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
    it("cross-tenant context without membership is denied", async () => {
      const outsider = new PostgresSales(apiPool, {
        tenantId: tenantB,
        userId: clerkUser,
      });
      await expect(
        completeSaleTransaction(outsider, command()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("historical snapshots are read without consulting current product", async () => {
      const c = command();
      const first = await completeSaleTransaction(sales(), c);
      await db.editProduct(product, (p) => ({
        ...p,
        name: productName("Nuevo"),
        salePrice: money(9000n),
      }));
      expect(await sales().readSale(c.draft.id)).toEqual(first.recorded);
    });
    it("revoked membership cannot replay a recorded sale", async () => {
      const c = command();
      await completeSaleTransaction(sales(), c);
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND user_id=$2",
        [tenantA, ownerUser],
      );
      await expect(completeSaleTransaction(sales(), c)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
    it("SQL monetary constraint agrees with exact bigint at large values", async () => {
      const p = await db.editProduct(product, (p) => ({
        ...p,
        salePrice: money(100000000000000001n),
      }));
      const c = command();
      const draft = addSaleProduct(
        createSaleDraft(c.draft.id),
        p,
        quantity("piece", 1000n),
      );
      const result = await completeSaleTransaction(sales(), {
        ...c,
        draft,
        payments: [{ method: "cash", amount: draft.total }],
      });
      expect(result.recorded.sale.total.minorUnits).toBe(100000000000000001n);
      const raw = await admin.query<{ exact: string }>(
        "SELECT div(100000000000000001::numeric*1000+500,1000)::text AS exact",
      );
      expect(raw.rows[0]?.exact).toBe("100000000000000001");
      const invalidId = randomUUID();
      await expect(
        sql(tenantA, async (client) => {
          await client.query(
            `INSERT INTO retail.sales(id,tenant_id,location_id,status,total_minor_units,created_by,command_payload,shift_id) VALUES($1,$2,$3,'completed',100000000000000002,$4,'{}',$5)`,
            [invalidId, tenantA, source, ownerUser, shiftId],
          );
          return client.query(
            `INSERT INTO retail.sale_lines(tenant_id,sale_id,product_id,ordinal,sku,product_name,unit,quantity_milli_units,unit_price_minor_units,line_total_minor_units,movement_id)
          VALUES($1,$2,$3,0,$4,$5,'piece',1000,100000000000000001,100000000000000002,$6)`,
            [tenantA, invalidId, product, p.sku, p.name, randomUUID()],
          );
        }),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "sale_lines_check",
      });
    });
    it("SQL refuses a sale with no line, payment or stock movement", async () => {
      await expect(
        sql(tenantA, (c) =>
          c.query(
            `INSERT INTO retail.sales(id,tenant_id,location_id,status,total_minor_units,created_by,command_payload,shift_id) VALUES($1,$2,$3,'completed',1,$4,'{}',$5)`,
            [randomUUID(), tenantA, source, ownerUser, shiftId],
          ),
        ),
      ).rejects.toThrow();
      expect((await counts())?.sales).toBe("0");
    });
    it("SQL denies rewriting snapshots and appending payments after commit", async () => {
      const c = command();
      await completeSaleTransaction(sales(), c);
      await expect(
        sql(tenantA, (tx) =>
          tx.query(
            "UPDATE retail.sale_lines SET unit_price_minor_units=1 WHERE sale_id=$1",
            [c.draft.id],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        sql(tenantA, (tx) =>
          tx.query(
            "INSERT INTO retail.sale_payments(tenant_id,sale_id,method,amount_minor_units) VALUES($1,$2,'card',1)",
            [tenantA, c.draft.id],
          ),
        ),
      ).rejects.toThrow();
      expect(await stock()).toBe(9000n);
    });
    it("reused movement identity rolls back the whole checkout", async () => {
      const c = command();
      const recorded = await admin.query<{ id: string }>(
        "SELECT id FROM retail.inventory_commands LIMIT 1",
      );
      await expect(
        completeSaleTransaction(sales(), {
          ...c,
          movements: [{ productId: product, movementId: recorded.rows[0]!.id }],
        }),
      ).rejects.toBeInstanceOf(SaleIdempotencyConflictError);
      expect(await stock()).toBe(10000n);
      expect((await counts())?.sales).toBe("0");
    });
  });

  describe("cash register integration", () => {
    const cash = (userId = ownerUser, tenantId = tenantA) =>
      new PostgresCash(pool, { userId, tenantId });
    const move = (
      type: "cash_in" | "cash_out",
      amount: bigint,
      id = randomUUID(),
    ) =>
      recordCashMovement(cash(), {
        id,
        shiftId,
        type,
        amount: money(amount),
        reason: "SMOKE cash",
      });
    const sale = (
      method: "cash" | "card" | "mixed" = "cash",
      sid: string | undefined = shiftId,
    ) => {
      const draft = addSaleProduct(
        createSaleDraft(randomUUID()),
        fixtureProduct(),
        quantity("piece", 1000n),
      );
      return completeSaleTransaction(
        new PostgresSales(pool, { userId: ownerUser, tenantId: tenantA }),
        {
          ...(sid === undefined ? {} : { shiftId: sid }),
          draft,
          locationId: source,
          payments:
            method === "mixed"
              ? [
                  { method: "cash", amount: money(700n) },
                  { method: "card", amount: money(1300n) },
                ]
              : [{ method, amount: draft.total }],
          movements: [{ productId: product, movementId: randomUUID() }],
        },
      );
    };
    it("opening zero stores trusted actor and time", async () => {
      const s = await cash().currentShift(source);
      expect(s?.openingCash.minorUnits).toBe(0n);
      expect(s?.openedBy).toBe(ownerUser);
      expect(s?.status).toBe("open");
    });
    it("second opening at one location conflicts", async () => {
      await expect(
        openCashRegisterShift(cash(), {
          id: randomUUID(),
          locationId: source,
          openingCash: money(1n),
        }),
      ).rejects.toBeInstanceOf(CashStateConflictError);
    });
    it("simultaneous openings commit exactly one", async () => {
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          openCashRegisterShift(cash(), {
            id: randomUUID(),
            locationId: destination,
            openingCash: money(100n),
          }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
    it("income and withdrawal derive expected from ledger", async () => {
      await move("cash_in", 100n);
      await move("cash_out", 40n);
      const s = await cash().currentShift(source);
      expect(s?.expectedCash.minorUnits).toBe(60n);
      expect(s?.cashIn.minorUnits).toBe(100n);
      expect(s?.cashOut.minorUnits).toBe(40n);
    });
    it("insufficient withdrawal rolls back", async () => {
      await expect(move("cash_out", 1n)).rejects.toBeInstanceOf(
        CashStateConflictError,
      );
      expect((await cash().currentShift(source))?.cashOut.minorUnits).toBe(0n);
    });
    it.each([
      ["cash", 2000n],
      ["card", 0n],
      ["mixed", 700n],
    ] as const)(
      "sale %s credits physical cash exactly",
      async (method, expected) => {
        const r = await sale(method);
        expect(r.recorded.shiftId).toBe(shiftId);
        expect((await cash().currentShift(source))?.salesCash.minorUnits).toBe(
          expected,
        );
        expect(await stock()).toBe(9000n);
      },
    );
    it.each([0n, 10n, -10n])("close permits difference %s", async (diff) => {
      await move("cash_in", 100n);
      const result = await closeCashRegisterShift(
        cash(),
        shiftId,
        money(100n + diff),
      );
      expect(result.status).toBe("closed");
      expect(result.expectedCash.minorUnits).toBe(100n);
      expect(result.difference?.minorUnits).toBe(diff);
    });
    it("after close, new sales, movement and second close fail", async () => {
      await closeCashRegisterShift(cash(), shiftId, money(0n));
      await expect(sale()).rejects.toBeInstanceOf(CashStateConflictError);
      await expect(move("cash_in", 1n)).rejects.toBeInstanceOf(
        CashStateConflictError,
      );
      await expect(move("cash_out", 1n)).rejects.toBeInstanceOf(
        CashStateConflictError,
      );
      await expect(
        closeCashRegisterShift(cash(), shiftId, money(0n)),
      ).rejects.toBeInstanceOf(CashStateConflictError);
      expect(await stock()).toBe(10000n);
    });
    it("no shift ID cannot silently attach to another shift", async () => {
      const draft = addSaleProduct(
        createSaleDraft(randomUUID()),
        fixtureProduct(),
        quantity("piece", 1000n),
      );
      await expect(
        completeSaleTransaction(
          new PostgresSales(pool, { userId: ownerUser, tenantId: tenantA }),
          {
            draft,
            locationId: source,
            payments: [{ method: "cash", amount: draft.total }],
            movements: [{ productId: product, movementId: randomUUID() }],
          },
        ),
      ).rejects.toBeInstanceOf(CashStateConflictError);
    });
    it("two simultaneous closes commit exactly one", async () => {
      const results = await Promise.allSettled(
        [1, 2].map(() => closeCashRegisterShift(cash(), shiftId, money(0n))),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
    it("concurrent withdrawals cannot overspend cash", async () => {
      await move("cash_in", 100n);
      const r = await Promise.allSettled([
        move("cash_out", 60n),
        move("cash_out", 60n),
      ]);
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect((await cash().currentShift(source))?.expectedCash.minorUnits).toBe(
        40n,
      );
    });
    it("close holding shift lock excludes a racing sale", async () => {
      let racing: ReturnType<typeof sale> | undefined;
      await sql(tenantA, async (c) => {
        await c.query("SELECT retail.lock_cash_shift($1)", [shiftId]);
        racing = sale();
        await c.query("SELECT retail.close_cash_shift($1,0)", [shiftId]);
      });
      await expect(racing).rejects.toBeInstanceOf(CashStateConflictError);
      expect(await stock()).toBe(10000n);
    });
    it("sale-close race freezes a coherent snapshot", async () => {
      const r = await Promise.allSettled([
        sale(),
        closeCashRegisterShift(cash(), shiftId, money(0n)),
      ]);
      expect(r[1]?.status).toBe("fulfilled");
      const expected = r[0]?.status === "fulfilled" ? 2000n : 0n;
      const s = await cash().currentShift(source);
      expect(s?.expectedCash.minorUnits).toBe(expected);
      expect(s?.salesCash.minorUnits).toBe(expected);
      expect(await stock()).toBe(expected === 0n ? 10000n : 9000n);
    });
    it("inventory clerk cannot read/open/move/close cash", async () => {
      const repo = cash(clerkUser);
      await expect(repo.currentShift(source)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(
        repo.openShift({
          id: randomUUID(),
          locationId: destination,
          openingCash: money(0n),
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        repo.moveCash({
          id: randomUUID(),
          shiftId,
          type: "cash_in",
          amount: money(1n),
          reason: "SMOKE",
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(repo.closeShift(shiftId, money(0n))).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
    it("tenant context cannot reference a foreign shift", async () => {
      await expect(
        cash(ownerUser, tenantB).moveCash({
          id: randomUUID(),
          shiftId,
          type: "cash_in",
          amount: money(1n),
          reason: "SMOKE",
        }),
      ).rejects.toBeInstanceOf(CashStateConflictError);
    });
    it("cash ledger cannot be edited or deleted", async () => {
      const m = await move("cash_in", 10n);
      for (const q of [
        "UPDATE retail.cash_movements SET amount=1 WHERE id=$1",
        "DELETE FROM retail.cash_movements WHERE id=$1",
        "UPDATE retail.cash_register_shifts SET opening_cash=1 WHERE id=$1",
      ]) {
        await expect(
          sql(tenantA, (c) =>
            c.query(q, [q.includes("cash_movements") ? m.id : shiftId]),
          ),
        ).rejects.toThrow();
      }
      expect((await cash().currentShift(source))?.expectedCash.minorUnits).toBe(
        10n,
      );
    });
    it("movement retry preserves one immutable record", async () => {
      const id = randomUUID();
      const first = await move("cash_in", 10n, id);
      expect(await move("cash_in", 10n, id)).toEqual(first);
      await expect(move("cash_in", 11n, id)).rejects.toBeInstanceOf(
        CashStateConflictError,
      );
      expect((await cash().currentShift(source))?.expectedCash.minorUnits).toBe(
        10n,
      );
    });
    it("SQL cannot append a sale payment after closing its shift in the same transaction", async () => {
      const id = randomUUID();
      await expect(
        sql(tenantA, async (c) => {
          await c.query(
            "INSERT INTO retail.sales(id,tenant_id,location_id,status,total_minor_units,created_by,command_payload,shift_id) VALUES($1,$2,$3,'completed',2000,$4,'{}',$5)",
            [id, tenantA, source, ownerUser, shiftId],
          );
          await c.query("SELECT retail.close_cash_shift($1,0)", [shiftId]);
          await c.query(
            "INSERT INTO retail.sale_payments(tenant_id,sale_id,method,amount_minor_units) VALUES($1,$2,'cash',2000)",
            [tenantA, id],
          );
        }),
      ).rejects.toMatchObject({ code: "P0001" });
      expect((await cash().currentShift(source))?.status).toBe("open");
      expect(
        (
          await admin.query("SELECT count(*) FROM retail.sales WHERE id=$1", [
            id,
          ])
        ).rows[0]?.count,
      ).toBe("0");
    });
    it("accumulated cash cannot exceed BIGINT and remains closable", async () => {
      const id = randomUUID(),
        max = 9223372036854775807n;
      await openCashRegisterShift(cash(), {
        id,
        locationId: destination,
        openingCash: money(max),
      });
      await expect(
        recordCashMovement(cash(), {
          id: randomUUID(),
          shiftId: id,
          type: "cash_in",
          amount: money(1n),
          reason: "SMOKE",
        }),
      ).rejects.toBeInstanceOf(RangeError);
      expect(
        (await cash().currentShift(destination))?.expectedCash.minorUnits,
      ).toBe(max);
      expect(
        (await closeCashRegisterShift(cash(), id, money(max))).difference
          ?.minorUnits,
      ).toBe(0n);
    });
    it("sale cash overflow rolls back sale and inventory atomically", async () => {
      await move("cash_in", 9223372036854775807n);
      await expect(sale()).rejects.toBeInstanceOf(RangeError);
      expect(await stock()).toBe(10000n);
      expect((await cash().currentShift(source))?.salesCash.minorUnits).toBe(
        0n,
      );
    });
    it("cash retries normalize UUID casing", async () => {
      const first = await move("cash_in", 10n);
      const result = await recordCashMovement(cash(), {
        id: first.id.toUpperCase(),
        shiftId: shiftId.toUpperCase(),
        type: "cash_in",
        amount: money(10n),
        reason: "SMOKE cash",
      });
      expect(result).toEqual(first);
      const opening = await openCashRegisterShift(cash(), {
        id: shiftId.toUpperCase(),
        locationId: source.toUpperCase(),
        openingCash: money(0n),
      });
      expect(opening.id).toBe(shiftId);
      expect(opening.expectedCash.minorUnits).toBe(10n);
    });
    it("receipt/history and replay survive shift closing", async () => {
      const created = await sale();
      const repo = new PostgresSales(pool, {
        userId: ownerUser,
        tenantId: tenantA,
      });
      await closeCashRegisterShift(cash(), shiftId, money(2000n));
      const history = await repo.listSales();
      expect(history[0]).toEqual(created.recorded);
      expect(
        (await repo.readSale(created.recorded.sale.id)).sale.lines[0]?.name,
      ).toBe("Producto");
    });
  });

  describe("cloud runtime preparation", () => {
    it("runtime role is restricted, can operate for a member and denies another tenant", async () => {
      const role = await apiPool.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
      }>(
        "SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user",
      );
      expect(role.rows[0]).toEqual({
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      });
      const runtime = new PostgresInventory(apiPool, {
        userId: clerkUser,
        tenantId: tenantA,
      });
      expect(await runtime.listStock()).toHaveLength(2);
      await receiveInventory(runtime, receipt(1000n));
      expect(await stock()).toBe(11000n);
      await expect(
        new PostgresInventory(apiPool, {
          userId: clerkUser,
          tenantId: tenantB,
        }).listStock(),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        apiPool.query(
          "INSERT INTO retail.tenant_memberships VALUES($1,$2,'owner','active')",
          [tenantB, clerkUser],
        ),
      ).rejects.toThrow();
    });
    it("transaction-scoped timeout and tenant identity do not leak to later requests", async () => {
      const runtime = new PostgresInventory(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      });
      await runtime.listStock();
      await expect(
        new PostgresInventory(apiPool, {
          userId: outsiderUser,
          tenantId: tenantA,
        }).listStock(),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      const after = await apiPool.query<{
        tenant: string | null;
        user: string | null;
        timeout: string;
      }>(
        "SELECT current_setting('app.tenant_id',true) AS tenant,current_setting('app.user_id',true) AS user,current_setting('statement_timeout') AS timeout",
      );
      expect(after.rows[0]?.tenant ?? "").toBe("");
      expect(after.rows[0]?.user ?? "").toBe("");
      expect(after.rows[0]?.timeout).toBe("0");
    });
  });

  describe("inventory web persistence", () => {
    const countCommand = (amount = 10000n) => ({
      ...key,
      id: inventoryMovementId(randomUUID()),
      counted: quantity("piece", amount),
      reason,
    });
    it("lists locations and exact stock including uninitialized zero balances", async () => {
      expect(await db.listLocations()).toHaveLength(2);
      const values = await db.listStock();
      expect(values).toHaveLength(2);
      expect(
        values.find((row) => row.balance.locationId === destination)?.balance
          .quantity.milliUnits,
      ).toBe(0n);
      expect(
        values.find((row) => row.balance.locationId === source),
      ).toMatchObject({ productName: "Producto", sku: "SKU-1" });
      const stored = await admin.query(
        "SELECT * FROM retail.stock_balances WHERE tenant_id=$1",
        [tenantA],
      );
      expect(stored.rowCount).toBe(1);
    });
    it("filters stock and returns missing/foreign location as not found", async () => {
      expect(await db.listStock(source)).toHaveLength(1);
      await expect(db.listStock(randomUUID())).rejects.toThrow(
        "StockBalance not found",
      );
      const id = inventoryLocationId(randomUUID());
      await other.createLocation(
        createInventoryLocation({
          id,
          code: inventoryLocationCode("FOREIGN"),
          name: inventoryLocationName("Ajena"),
          status: "active",
        }),
      );
      await expect(db.listStock(id)).rejects.toThrow("StockBalance not found");
      await expect(
        receiveInventory(db, { ...receipt(), locationId: id }),
      ).rejects.toThrow("StockBalance not found");
      expect(await stock()).toBe(10000n);
    });
    it("revalidates membership for location/stock reads and location creation", async () => {
      const outsider = new PostgresInventory(pool, {
        tenantId: tenantA,
        userId: outsiderUser,
      });
      await expect(outsider.listLocations()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(outsider.listStock()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      const clerk = new PostgresInventory(pool, {
        tenantId: tenantA,
        userId: clerkUser,
      });
      expect(await clerk.listStock()).toHaveLength(2);
      await expect(
        clerk.createLocation((await db.listLocations())[0]!),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      const memberships = await listTenantMemberships(pool, clerkUser);
      expect(memberships[0]?.permissions).toContain("inventory.issue");
      expect(memberships[0]?.permissions).not.toContain("inventory.adjust");
    });
    it("deduplicates location creation and rejects changed payload", async () => {
      const value = createInventoryLocation({
        id: inventoryLocationId(randomUUID()),
        code: inventoryLocationCode("NEW"),
        name: inventoryLocationName("Nueva"),
        status: "active",
      });
      expect(
        await Promise.all([db.createLocation(value), db.createLocation(value)]),
      ).toEqual([value, value]);
      await expect(
        db.createLocation({
          ...value,
          name: inventoryLocationName("Otro nombre"),
        }),
      ).rejects.toBeInstanceOf(InventoryIdempotencyConflictError);
      expect(await db.listLocations()).toHaveLength(3);
    });
    it("durably replays a no-change count after stock changes without a ledger entry", async () => {
      const command = countCommand();
      const first = await reconcileInventory(db, command);
      await receiveInventory(db, receipt(2000n));
      expect(await reconcileInventory(db, command)).toEqual(first);
      expect(first.status).toBe("no-change");
      expect(await stock()).toBe(12000n);
      expect(
        (
          await sql(tenantA, (client) =>
            client.query(
              "SELECT * FROM retail.inventory_movements WHERE id=$1",
              [command.id],
            ),
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await sql(tenantA, (client) =>
            client.query("SELECT * FROM retail.inventory_counts WHERE id=$1", [
              command.id,
            ]),
          )
        ).rowCount,
      ).toBe(1);
    });
    it("replays an adjusted count after a later movement without resetting current stock", async () => {
      const command = countCommand(8000n);
      const first = await reconcileInventory(db, command);
      await receiveInventory(db, receipt(1000n));
      expect(await reconcileInventory(db, command)).toEqual(first);
      expect(await stock()).toBe(9000n);
    });
    it("concurrent identical counts create one receipt and changed input conflicts", async () => {
      const command = countCommand();
      const results = await Promise.all([
        reconcileInventory(db, command),
        reconcileInventory(db, command),
      ]);
      expect(results[0]).toEqual(results[1]);
      await expect(
        reconcileInventory(db, {
          ...command,
          counted: quantity("piece", 9000n),
        }),
      ).rejects.toBeInstanceOf(InventoryIdempotencyConflictError);
      expect(await stock()).toBe(10000n);
    });
    it("rejects count IDs reused for receive/issue and adjustments reused as counts", async () => {
      const command = countCommand();
      await reconcileInventory(db, command);
      await expect(
        receiveInventory(db, { ...receipt(1000n), id: command.id }),
      ).rejects.toBeInstanceOf(InventoryIdempotencyConflictError);
      await expect(
        issueInventory(db, { ...issue(1000n), id: command.id }),
      ).rejects.toBeInstanceOf(InventoryIdempotencyConflictError);
      const independent = {
        ...key,
        id: inventoryMovementId(randomUUID()),
        type: "adjustment" as const,
        delta: quantity("piece", 1000n),
        reason,
      };
      await adjustInventory(db, independent);
      await expect(
        reconcileInventory(db, { ...countCommand(11000n), id: independent.id }),
      ).rejects.toBeInstanceOf(InventoryIdempotencyConflictError);
      expect(await stock()).toBe(11000n);
    });
    it("concurrent cross-kind use on separate balances reserves one shared identity", async () => {
      const id = inventoryMovementId(randomUUID());
      const results = await Promise.allSettled([
        reconcileInventory(db, { ...countCommand(), id }),
        receiveInventory(db, {
          ...receipt(1000n),
          id,
          locationId: destination,
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const failure = results.find((result) => result.status === "rejected");
      expect(
        failure?.status === "rejected" ? failure.reason : undefined,
      ).toBeInstanceOf(InventoryIdempotencyConflictError);
      expect(await stock()).toBe(10000n);
      expect(await stock(destination)).toBe(
        results[0]?.status === "fulfilled" ? 0n : 1000n,
      );
    });
    it("revoked membership and clerk cannot replay a stored count", async () => {
      const command = countCommand();
      await reconcileInventory(db, command);
      const clerk = new PostgresInventory(pool, {
        tenantId: tenantA,
        userId: clerkUser,
      });
      await expect(reconcileInventory(clerk, command)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND user_id=$2",
        [tenantA, ownerUser],
      );
      await expect(reconcileInventory(db, command)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
    it("rejects forged count snapshots and keeps receipts immutable", async () => {
      const command = countCommand();
      await reconcileInventory(db, command);
      await expect(
        sql(tenantA, (client) =>
          client.query(
            "INSERT INTO retail.inventory_counts(id,tenant_id,product_id,location_id,unit,counted,reason,status) VALUES($1,$2,$3,$4,'piece',999,'fake','no-change')",
            [randomUUID(), tenantA, product, source],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        sql(tenantA, (client) =>
          client.query("UPDATE retail.inventory_counts SET counted=0"),
        ),
      ).rejects.toThrow();
      await expect(
        sql(tenantA, (client) =>
          client.query("DELETE FROM retail.inventory_counts"),
        ),
      ).rejects.toThrow();
      const foreign = await sql(tenantB, (client) =>
        client.query("SELECT * FROM retail.inventory_counts WHERE id=$1", [
          command.id,
        ]),
      );
      expect(foreign.rowCount).toBe(0);
    });
  });

  it("maps exact money, unit, status and nullable barcode", async () => {
    const value = fixtureProduct(productId(randomUUID()), "NULL-BAR", null);
    const stored = await db.createProduct({
      ...value,
      salePrice: money(9007199254740993n),
    });
    expect(stored.salePrice.minorUnits).toBe(9007199254740993n);
    expect(stored).not.toHaveProperty("barcode");
    expect(stored.unit).toBe("piece");
    expect(stored.status).toBe("active");
  });
  it("enforces SKU uniqueness within each tenant", async () => {
    await expect(
      db.createProduct(fixtureProduct(productId(randomUUID()), "SKU-1", "456")),
    ).rejects.toBeInstanceOf(DatabaseUniquenessConflictError);
  });
  it("enforces barcode uniqueness and permits multiple NULL barcodes", async () => {
    await expect(
      db.createProduct(fixtureProduct(productId(randomUUID()), "OTHER", "123")),
    ).rejects.toBeInstanceOf(DatabaseUniquenessConflictError);
    await db.createProduct(
      fixtureProduct(productId(randomUUID()), "NULL-1", null),
    );
    await db.createProduct(
      fixtureProduct(productId(randomUUID()), "NULL-2", null),
    );
  });
  it("fails closed without tenant context and after transaction-local context resets", async () => {
    expect(
      (await sql(tenantA, (c) => c.query("SELECT * FROM retail.products")))
        .rowCount,
    ).toBe(1);
    expect(
      (await sql(undefined, (c) => c.query("SELECT * FROM retail.products")))
        .rowCount,
    ).toBe(0);
    await expect(
      sql("not-a-uuid", (c) => c.query("SELECT * FROM retail.products")),
    ).rejects.toThrow();
  });
  it("RLS hides tenant B and rejects cross-tenant INSERT", async () => {
    expect(
      (
        await sql(tenantA, (c) =>
          c.query("SELECT * FROM retail.products WHERE tenant_id=$1", [
            tenantB,
          ]),
        )
      ).rowCount,
    ).toBe(0);
    await expect(
      sql(tenantA, (c) =>
        c.query(
          "INSERT INTO retail.inventory_locations(tenant_id,id,code,name,status) VALUES ($1,$2,'X','X','active')",
          [tenantB, randomUUID()],
        ),
      ),
    ).rejects.toThrow();
  });
  it("composite FKs reject a product belonging only to another tenant", async () => {
    const foreign = productId(randomUUID());
    await other.createProduct(fixtureProduct(foreign, "FOREIGN", "789"));
    await expect(
      receiveInventory(db, { ...receipt(), productId: foreign }),
    ).rejects.toThrow();
  });
  it("all tenant tables force RLS and app role is neither owner nor bypass", async () => {
    const tables = await admin.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='retail' AND c.relkind='r' AND c.relname <> 'role_permissions'",
    );
    expect(tables.rows).toHaveLength(19);
    expect(
      tables.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
    ).toBe(true);
    await expect(
      new PostgresInventory(admin, {
        tenantId: tenantA,
        userId: ownerUser,
      }).run([], async () => undefined, "inventory.read"),
    ).rejects.toThrow("Unsafe database application role");
  });
  it("DB denies direct balance edits and nonzero initialization", async () => {
    await expect(
      sql(tenantA, (c) =>
        c.query(
          "UPDATE retail.stock_balances SET milli_units=999 WHERE tenant_id=$1",
          [tenantA],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      sql(tenantA, (c) =>
        c.query(
          "INSERT INTO retail.stock_balances VALUES ($1,$2,$3,'piece',99)",
          [tenantA, product, destination],
        ),
      ),
    ).rejects.toThrow();
    expect(await stock()).toBe(10000n);
  });
  it("ledger cannot be updated or deleted by app role", async () => {
    await expect(
      sql(tenantA, (c) =>
        c.query("UPDATE retail.inventory_movements SET amount=1"),
      ),
    ).rejects.toThrow();
    await expect(
      sql(tenantA, (c) => c.query("DELETE FROM retail.inventory_movements")),
    ).rejects.toThrow();
  });
  it("replays the original receipt result without duplicating stock", async () => {
    const command = receipt(2000n);
    const first = await receiveInventory(db, command);
    await issueInventory(db, issue(1000n));
    expect(await receiveInventory(db, command)).toEqual(first);
    expect(await stock()).toBe(11000n);
  });
  it("replays an issue even when current stock would be insufficient", async () => {
    const command = issue(10000n);
    const result = await issueInventory(db, command);
    expect(await issueInventory(db, command)).toEqual(result);
    expect(await stock()).toBe(0n);
  });
  it("rejects reused movement ID with changed payload", async () => {
    const command = receipt(2000n);
    await receiveInventory(db, command);
    await expect(
      receiveInventory(db, { ...command, quantity: quantity("piece", 1n) }),
    ).rejects.toBeInstanceOf(InventoryIdempotencyConflictError);
    expect(await stock()).toBe(12000n);
  });
  it("two concurrent issues cannot overspend stock", async () => {
    const results = await Promise.allSettled([
      issueInventory(db, issue(7000n)),
      issueInventory(db, issue(7000n)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stock()).toBe(3000n);
  });
  it("simultaneous retry of one movement creates one durable ledger entry", async () => {
    const command = receipt(2000n);
    const results = await Promise.all([
      receiveInventory(db, command),
      receiveInventory(db, command),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await stock()).toBe(12000n);
    expect(
      (
        await sql(tenantA, (c) =>
          c.query("SELECT id FROM retail.inventory_movements WHERE id=$1", [
            command.id,
          ]),
        )
      ).rowCount,
    ).toBe(1);
  });
  it("transfers and durably replays with the original two results", async () => {
    const command = transfer(10000n);
    const first = await transferInventory(db, command);
    expect(first.sourceBalance.quantity.milliUnits).toBe(0n);
    expect(first.destinationBalance.quantity.milliUnits).toBe(10000n);
    expect(await transferInventory(db, command)).toEqual(first);
    expect(await stock(destination)).toBe(10000n);
  });
  it("changed transfer payload conflicts", async () => {
    const command = transfer();
    await transferInventory(db, command);
    await expect(
      transferInventory(db, { ...command, quantity: quantity("piece", 1n) }),
    ).rejects.toBeInstanceOf(InventoryIdempotencyConflictError);
    expect(await stock()).toBe(7000n);
  });
  it("simultaneous retries of transfer do not apply twice", async () => {
    const command = transfer();
    const results = await Promise.all([
      transferInventory(db, command),
      transferInventory(db, command),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await stock()).toBe(7000n);
    expect(await stock(destination)).toBe(3000n);
  });
  it("opposite concurrent transfers use deterministic locks", async () => {
    await receiveInventory(db, { ...receipt(), locationId: destination });
    const forward = transfer(1000n);
    const reverse = {
      ...transfer(2000n),
      sourceLocationId: destination,
      destinationLocationId: source,
    };
    await Promise.all([
      transferInventory(db, forward),
      transferInventory(db, reverse),
    ]);
    expect(await stock()).toBe(11000n);
    expect(await stock(destination)).toBe(9000n);
  });
  it("rejects destination BIGINT overflow before ledger writes and leaves balances intact", async () => {
    await receiveInventory(db, {
      ...receipt(9223372036854775807n),
      locationId: destination,
    });
    const command = transfer(1n);
    await expect(transferInventory(db, command)).rejects.toThrow();
    expect(await stock()).toBe(10000n);
    expect(await stock(destination)).toBe(9223372036854775807n);
    expect(
      (
        await sql(tenantA, (c) =>
          c.query("SELECT * FROM retail.inventory_transfers WHERE id=$1", [
            command.id,
          ]),
        )
      ).rowCount,
    ).toBe(0);
  });
  it("rolls back a source debit when receipt child ID already exists", async () => {
    const previous = receipt(1n);
    await receiveInventory(db, previous);
    const command = { ...transfer(), receiptMovementId: previous.id };
    await expect(transferInventory(db, command)).rejects.toBeInstanceOf(
      InventoryIdempotencyConflictError,
    );
    expect(await stock()).toBe(10001n);
    expect(await stock(destination)).toBe(0n);
    expect(
      (
        await sql(tenantA, (c) =>
          c.query("SELECT * FROM retail.inventory_movements WHERE id=$1", [
            command.issueMovementId,
          ]),
        )
      ).rowCount,
    ).toBe(0);
  });
  it("reconciles through adjustment and replays the stored result", async () => {
    const command = {
      ...key,
      id: inventoryMovementId(randomUUID()),
      counted: quantity("piece", 8000n),
      reason,
    };
    const result = await reconcileInventory(db, command);
    expect(result.status).toBe("adjusted");
    expect(await reconcileInventory(db, command)).toEqual(result);
    expect(await stock()).toBe(8000n);
  });
  it("adjustment validates units and protects nonnegative balances", async () => {
    await expect(
      adjustInventory(db, {
        ...key,
        id: inventoryMovementId(randomUUID()),
        type: "adjustment",
        delta: quantity("piece", -10001n),
        reason,
      }),
    ).rejects.toThrow();
    await expect(
      receiveInventory(db, { ...receipt(), quantity: quantity("kg", 1n) }),
    ).rejects.toThrow();
    expect(await stock()).toBe(10000n);
  });
  it("parameterized SQL treats valid hostile-looking text as data", async () => {
    const name = productName("x'); DROP TABLE retail.products; --");
    const stored = await db.createProduct({
      ...fixtureProduct(productId(randomUUID()), "SQL", null),
      name,
    });
    expect(stored.name).toBe(name);
    expect(
      (await sql(tenantA, (c) => c.query("SELECT * FROM retail.products")))
        .rowCount,
    ).toBe(2);
  });
  it("transaction ports cannot save without a movement or escape scope", async () => {
    let captured: InventoryTransaction | undefined;
    await db.run(
      [key],
      async (tx) => {
        captured = tx;
      },
      "inventory.read",
    );
    await expect(captured?.readBalance(key)).rejects.toThrow(
      "Transaction scope expired",
    );
    await expect(
      db.run(
        [key],
        async (tx) => {
          const current = await tx.readBalance(key);
          if (!current) throw new Error("Missing balance");
          await tx.saveBalance({
            ...current,
            quantity: quantity("piece", 999n),
          });
        },
        "inventory.read",
      ),
    ).rejects.toThrow("Balance must match");
  });
  it("tenant B cannot replay tenant A ledger and UUID casing does not defeat replay", async () => {
    const command = receipt(1n);
    await receiveInventory(db, command);
    await expect(receiveInventory(other, command)).rejects.toBeInstanceOf(
      InventoryIdempotencyConflictError,
    );
    const upper = {
      ...command,
      id: inventoryMovementId(command.id.toUpperCase()),
      productId: productId(product.toUpperCase()),
      locationId: inventoryLocationId(source.toUpperCase()),
    };
    await receiveInventory(db, upper);
    expect(await stock()).toBe(10001n);
  });

  describe("product web persistence", () => {
    it("enumerates only own active memberships without selected tenant", async () => {
      expect(await listTenantMemberships(pool, ownerUser)).toMatchObject([
        { tenantId: tenantA, canWriteProducts: true },
        { tenantId: tenantB, canWriteProducts: true },
      ]);
      expect(await listTenantMemberships(pool, clerkUser)).toMatchObject([
        { tenantId: tenantA, canWriteProducts: false },
      ]);
      expect(await listTenantMemberships(pool, outsiderUser)).toEqual([]);
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE user_id=$1",
        [clerkUser],
      );
      expect(await listTenantMemberships(pool, clerkUser)).toEqual([]);
    });
    it("own memberships policy does not reveal another subject", async () => {
      const result = await sql(
        undefined,
        (c) => c.query("SELECT user_id FROM retail.tenant_memberships"),
        clerkUser,
      );
      expect(result.rows).toEqual([{ user_id: clerkUser }]);
    });
    it("reader can list products but cannot edit", async () => {
      const clerk = new PostgresInventory(pool, {
        tenantId: tenantA,
        userId: clerkUser,
      });
      expect(await clerk.listProducts()).toHaveLength(1);
      await expect(
        updateProduct(clerk, product, { name: "Denied" }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      expect((await db.listProducts())[0]?.name).toBe("Producto");
    });
    it("foreign tenant list/edit denied", async () => {
      const foreign = new PostgresInventory(pool, {
        tenantId: tenantB,
        userId: clerkUser,
      });
      await expect(foreign.listProducts()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(
        updateProduct(foreign, product, { name: "Denied" }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("creation and update preserve exact large price and lifecycle", async () => {
      const created = await db.createProduct(
        fixtureProduct(productId(randomUUID()), "NEW", "456"),
      );
      const updated = await updateProduct(db, created.id, {
        name: "Updated",
        purchaseCost: money(900719925474099301n),
        barcode: null,
        status: "inactive",
      });
      expect(updated.purchaseCost.minorUnits).toBe(900719925474099301n);
      expect(updated).not.toHaveProperty("barcode");
      expect(updated.status).toBe("inactive");
      expect(
        (await updateProduct(db, created.id, { status: "active" })).status,
      ).toBe("active");
    });
    it("concurrent patches preserve distinct field changes", async () => {
      await Promise.all([
        updateProduct(db, product, { name: "Concurrent" }),
        updateProduct(db, product, { salePrice: money(7777n) }),
      ]);
      expect((await db.listProducts())[0]).toMatchObject({
        name: "Concurrent",
        salePrice: money(7777n),
      });
    });
    it("duplicate SKU/barcode edits rollback", async () => {
      const otherProduct = await db.createProduct(
        fixtureProduct(productId(randomUUID()), "OTHER", "456"),
      );
      for (const patch of [{ sku: "SKU-1" }, { barcode: "123" }])
        await expect(
          updateProduct(db, otherProduct.id, patch),
        ).rejects.toBeInstanceOf(DatabaseUniquenessConflictError);
      expect(
        (await db.listProducts()).find((p) => p.id === otherProduct.id),
      ).toMatchObject({ sku: "OTHER", barcode: "456" });
    });
    it("foreign-only product ID is not found, never edited", async () => {
      const created = await other.createProduct(
        fixtureProduct(productId(randomUUID()), "OTHER", null),
      );
      await expect(
        updateProduct(db, created.id, { name: "Denied" }),
      ).rejects.toBeInstanceOf(ProductNotFoundError);
      expect(
        (await other.listProducts()).find((p) => p.id === created.id)?.name,
      ).toBe("Producto");
    });
    it("referenced unit cannot change and app cannot rewrite identity/tenant", async () => {
      await expect(
        updateProduct(db, product, { unit: "kg" }),
      ).rejects.toBeInstanceOf(ProductStorageConflictError);
      await expect(
        sql(tenantA, (c) =>
          c.query("UPDATE retail.products SET tenant_id=$1 WHERE id=$2", [
            tenantB,
            product,
          ]),
        ),
      ).rejects.toThrow();
      expect((await db.listProducts())[0]?.unit).toBe("piece");
    });
    it("direct SQL update cannot bypass clerk authorization", async () => {
      const result = await sql(
        tenantA,
        (c) =>
          c.query("UPDATE retail.products SET name='Denied' WHERE id=$1", [
            product,
          ]),
        clerkUser,
      );
      expect(result.rowCount).toBe(0);
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE user_id=$1",
        [ownerUser],
      );
      await expect(
        updateProduct(db, product, { name: "Denied" }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
  });

  describe("membership and authorization", () => {
    it("missing permission is denied before the callback", async () => {
      let called = false;
      const work = async () => {
        called = true;
      };
      await expect(
        Reflect.apply(db.run, db, [[], work]),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        Reflect.apply(db.run, db, [[], work, undefined]),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      expect(called).toBe(false);
    });
    const permissions: readonly Permission[] = [
      "products.read",
      "products.write",
      "locations.read",
      "locations.write",
      "inventory.read",
      "inventory.receive",
      "inventory.issue",
      "inventory.adjust",
      "inventory.transfer",
      "members.manage",
    ];
    const clerk = () =>
      new PostgresInventory(pool, { tenantId: tenantA, userId: clerkUser });
    it("active member reads its tenant", async () => {
      await clerk().authorize("inventory.read");
      const rows = await sql(
        tenantA,
        (c) => c.query("SELECT * FROM retail.products"),
        clerkUser,
      );
      expect(rows.rowCount).toBe(1);
    });
    it("nonmember is denied before any use case writes", async () => {
      const adapter = new PostgresInventory(pool, {
        tenantId: tenantA,
        userId: outsiderUser,
      });
      await expect(
        receiveInventory(adapter, receipt(1n)),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      expect(await stock()).toBe(10000n);
    });
    it("inactive membership denies application and direct table reads", async () => {
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE user_id=$1",
        [clerkUser],
      );
      await expect(clerk().authorize("inventory.read")).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      expect(
        (
          await sql(
            tenantA,
            (c) => c.query("SELECT * FROM retail.products"),
            clerkUser,
          )
        ).rowCount,
      ).toBe(0);
    });
    it("changing only tenant selection does not grant access", async () => {
      const adapter = new PostgresInventory(pool, {
        tenantId: tenantB,
        userId: clerkUser,
      });
      await expect(
        receiveInventory(adapter, receipt(1n)),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("direct SQL cannot read or write another tenant", async () => {
      expect(
        (
          await sql(
            tenantA,
            (c) =>
              c.query("SELECT * FROM retail.products WHERE tenant_id=$1", [
                tenantB,
              ]),
            clerkUser,
          )
        ).rowCount,
      ).toBe(0);
      await expect(
        sql(
          tenantB,
          (c) =>
            c.query(
              "INSERT INTO retail.stock_balances(tenant_id,product_id,location_id,unit) VALUES ($1,$2,$3,'piece')",
              [tenantB, product, source],
            ),
          clerkUser,
        ),
      ).rejects.toThrow();
    });
    it("clerk receives stock", async () => {
      expect(
        (await receiveInventory(clerk(), receipt(1000n))).balance.quantity
          .milliUnits,
      ).toBe(11000n);
    });
    it("clerk issues stock", async () => {
      expect(
        (await issueInventory(clerk(), issue(1000n))).balance.quantity
          .milliUnits,
      ).toBe(9000n);
    });
    it("clerk transfers stock atomically", async () => {
      const result = await transferInventory(clerk(), transfer(1000n));
      expect(result.sourceBalance.quantity.milliUnits).toBe(9000n);
      expect(result.destinationBalance.quantity.milliUnits).toBe(1000n);
    });
    it("clerk cannot adjust", async () => {
      await expect(
        adjustInventory(clerk(), {
          ...key,
          id: inventoryMovementId(randomUUID()),
          type: "adjustment",
          delta: quantity("piece", 1n),
          reason,
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("even a no-change count requires adjustment permission", async () => {
      await expect(
        reconcileInventory(clerk(), {
          ...key,
          id: inventoryMovementId(randomUUID()),
          counted: quantity("piece", 10000n),
          reason,
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("clerk cannot create products", async () => {
      await expect(
        clerk().createProduct(
          fixtureProduct(productId(randomUUID()), "NEW", null),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("clerk cannot create locations", async () => {
      await expect(
        clerk().createLocation(
          createInventoryLocation({
            id: inventoryLocationId(randomUUID()),
            code: inventoryLocationCode("NEW"),
            name: inventoryLocationName("New"),
            status: "active",
          }),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it.each([ownerUser, adminUser])(
      "owner/admin %s has all ten initial permissions",
      async (userId) => {
        const adapter = new PostgresInventory(pool, {
          tenantId: tenantA,
          userId,
        });
        for (const permission of permissions)
          await adapter.authorize(permission);
        expect(
          (
            await adjustInventory(adapter, {
              ...key,
              id: inventoryMovementId(randomUUID()),
              type: "adjustment",
              delta: quantity("piece", 1n),
              reason,
            })
          ).balance.quantity.milliUnits,
        ).toBe(10001n);
      },
    );
    it("missing user GUC fails closed", async () => {
      expect(
        (
          await sql(
            tenantA,
            (c) => c.query("SELECT * FROM retail.products"),
            null,
          )
        ).rowCount,
      ).toBe(0);
      await expect(
        sql(
          tenantA,
          (c) =>
            c.query("SELECT * FROM retail.lock_balance($1,$2)", [
              product,
              source,
            ]),
          null,
        ).then((r) => {
          expect(r.rowCount).toBe(0);
        }),
      ).resolves.toBeUndefined();
    });
    it("missing tenant GUC fails closed even with a valid user", async () => {
      expect(
        (
          await sql(
            undefined,
            (c) => c.query("SELECT * FROM retail.products"),
            clerkUser,
          )
        ).rowCount,
      ).toBe(0);
    });
    it("malformed user GUC fails closed", async () => {
      await expect(
        sql(
          tenantA,
          (c) => c.query("SELECT * FROM retail.products"),
          "invalid",
        ),
      ).rejects.toThrow();
    });
    it("normal login cannot insert its own membership", async () => {
      await expect(
        sql(
          tenantB,
          (c) =>
            c.query(
              "INSERT INTO retail.tenant_memberships VALUES ($1,$2,'owner','active')",
              [tenantB, clerkUser],
            ),
          clerkUser,
        ),
      ).rejects.toThrow();
    });
    it("normal login cannot elevate its own membership", async () => {
      await expect(
        sql(
          tenantA,
          (c) =>
            c.query(
              "UPDATE retail.tenant_memberships SET role='owner' WHERE user_id=$1",
              [clerkUser],
            ),
          clerkUser,
        ),
      ).rejects.toThrow();
    });
    it("normal login cannot rewrite role permissions", async () => {
      await expect(
        sql(
          tenantA,
          (c) =>
            c.query(
              "INSERT INTO retail.role_permissions VALUES ('inventory_clerk','inventory.adjust')",
            ),
          clerkUser,
        ),
      ).rejects.toThrow();
      await expect(clerk().authorize("members.manage")).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
    it("owner permission does not expose a bootstrap SQL write grant", async () => {
      await db.authorize("members.manage");
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "INSERT INTO retail.tenant_memberships VALUES ($1,$2,'owner','active')",
            [tenantA, outsiderUser],
          ),
        ),
      ).rejects.toThrow();
    });
    it("RLS rejects direct adjustment INSERT by clerk", async () => {
      await expect(
        sql(
          tenantA,
          (c) =>
            c.query(
              `INSERT INTO retail.inventory_movements(id,tenant_id,product_id,location_id,type,unit,amount,reason,balance_after)
        VALUES ($1,$2,$3,$4,'adjustment','piece',1,'Count',10001)`,
              [randomUUID(), tenantA, product, source],
            ),
          clerkUser,
        ),
      ).rejects.toThrow();
      expect(await stock()).toBe(10000n);
    });
    it("RLS rejects direct products INSERT by clerk", async () => {
      await expect(
        sql(
          tenantA,
          (c) =>
            c.query(
              `INSERT INTO retail.products(tenant_id,id,name,sku,unit,currency,purchase_cost,sale_price,status)
        VALUES ($1,$2,'X','X','piece','MXN',0,0,'active')`,
              [tenantA, randomUUID()],
            ),
          clerkUser,
        ),
      ).rejects.toThrow();
    });
    it("a later unauthorized ledger entry rolls back the whole transaction", async () => {
      await expect(
        clerk().run(
          [key],
          async (tx) => {
            const command = receipt(1n);
            await tx.appendMovement(command);
            const current = await tx.readBalance(key);
            if (!current) throw new Error("Missing balance");
            await tx.saveBalance(current);
            await tx.appendMovement({
              ...key,
              id: inventoryMovementId(randomUUID()),
              type: "adjustment",
              delta: quantity("piece", 1n),
              reason,
            });
          },
          "inventory.receive",
        ),
      ).rejects.toThrow();
      expect(await stock()).toBe(10000n);
      expect(
        (
          await sql(tenantA, (c) =>
            c.query("SELECT * FROM retail.inventory_movements"),
          )
        ).rowCount,
      ).toBe(1);
    });
    it("revocation is observed without reconstructing the adapter", async () => {
      const adapter = clerk();
      await adapter.authorize("inventory.receive");
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE user_id=$1",
        [clerkUser],
      );
      await expect(
        receiveInventory(adapter, receipt(1n)),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("replay cannot bypass permissions revoked after the original operation", async () => {
      const adapter = new PostgresInventory(pool, {
        tenantId: tenantA,
        userId: adminUser,
      });
      const command = {
        ...key,
        id: inventoryMovementId(randomUUID()),
        type: "adjustment" as const,
        delta: quantity("piece", 1n),
        reason,
      };
      await adjustInventory(adapter, command);
      await admin.query(
        "UPDATE retail.tenant_memberships SET role='inventory_clerk' WHERE user_id=$1",
        [adminUser],
      );
      await expect(adjustInventory(adapter, command)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      expect(await stock()).toBe(10001n);
    });
    it("unknown permissions and client-supplied roles grant nothing", async () => {
      await expect(
        Reflect.apply(clerk().authorize, clerk(), ["inventory.everything"]),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      const adapter = new PostgresInventory(pool, {
        ...{ role: "owner" },
        tenantId: tenantA,
        userId: clerkUser,
      });
      await expect(
        adapter.authorize("inventory.adjust"),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("UUID identity is required and membership constraints reject invalid data", async () => {
      expect(
        () =>
          new PostgresInventory(pool, {
            tenantId: tenantA,
            userId: "email@example.invalid",
          }),
      ).toThrow();
      expect(() =>
        Reflect.construct(PostgresInventory, [pool, { tenantId: tenantA }]),
      ).toThrow();
      await expect(
        admin.query(
          "INSERT INTO retail.tenant_memberships VALUES ($1,$2,'cashier','active')",
          [tenantA, outsiderUser],
        ),
      ).rejects.toThrow();
      await expect(
        admin.query(
          "INSERT INTO retail.tenant_memberships VALUES ($1,$2,'owner','unknown')",
          [tenantA, outsiderUser],
        ),
      ).rejects.toThrow();
      await expect(
        admin.query(
          "INSERT INTO retail.tenant_memberships VALUES ($1,$2,'admin','active')",
          [tenantA, ownerUser],
        ),
      ).rejects.toThrow();
    });
  });
});

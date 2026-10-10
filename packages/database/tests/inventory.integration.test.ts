import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  PostgresProductImages,
  ProductImageConflictError,
  ProductImageRateLimitError,
} from "../src/product-images";
import { PostgresSupport } from "../src/support";
import {
  SupportUnavailableError,
  SupportConflictError,
  SupportRateLimitError,
} from "@smartretail/application";
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
  PurchaseConflictError,
  discount,
  priceDiscountedSale,
  DiscountLimitError,
  DiscountUnavailableError,
  createInventoryIssue,
  applyInventoryMovement,
  type DiscountIntent,
  type PurchaseDraftInput,
  type InventoryTransfer,
  type Quantity,
} from "@smartretail/domain";
import {
  receiveInventory,
  issueInventory,
  adjustInventory,
  transferInventory,
  reconcileInventory,
  InventoryIdempotencyConflictError,
  PermissionDeniedError,
  defaultBusinessProfile,
  BusinessSettingsNotFoundError,
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
  CustomerNotFoundError,
  CustomerUnavailableError,
  reportPeriod,
  type ReportFilters,
  CashStateConflictError,
  openCashRegisterShift,
  recordCashMovement,
  closeCashRegisterShift,
  type Permission,
  type InventoryTransaction,
} from "@smartretail/application";
import {
  PostgresInventory,
  PostgresBusiness,
  PostgresPlatform,
  PostgresOnboarding,
  OnboardingConflictError,
  InvitationUnavailableError,
  PostgresMembers,
  PostgresInventoryMinimum,
  PostgresPurchasing,
  PostgresCustomers,
  PostgresReporting,
  PostgresSales,
  PostgresSuspendedSales,
  PostgresCash,
  PostgresSaleReturns,
  DatabaseUniquenessConflictError,
  listTenantMemberships,
  ProductStorageConflictError,
  PostgresPromotions,
  PostgresTaxes,
  PostgresReceivables,
  PostgresPayables,
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
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.audit_log') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/010_audit_log.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sale_return_audit_complete') AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL(
            "../migrations/011_harden_sale_return_audit.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.purchase_orders') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/012_purchasing.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.customers') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/013_customers.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT 1 FROM retail.role_permissions WHERE permission='reports.read' LIMIT 1",
        )
      ).rowCount
    )
      await admin.query(
        await readFile(
          new URL("../migrations/014_reporting.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.inventory_minimums') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/015_inventory_minimums.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.member_locations') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/016_cashier_locations.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.coupons') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/017_discounts.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.tax_profiles') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/018_taxes.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.receivables') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/019_credit.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.payables') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/020_payables_expenses.sql", import.meta.url),
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
    if (
      !(
        await admin.query(
          "SELECT to_regclass('retail.business_profiles') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists
    )
      await admin.query(
        await readFile(
          new URL("../migrations/021_business_settings.sql", import.meta.url),
          "utf8",
        ),
      );
    if (
      !(await admin.query("SELECT to_regclass('retail.platform_admins') t"))
        .rows[0].t
    ) {
      // Disposable test-only Auth identity directory, not a production Auth replacement.
      await admin.query(
        "CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY,email text); ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY; ALTER TABLE auth.users FORCE ROW LEVEL SECURITY",
      );
      await admin.query(
        await readFile(
          new URL("../migrations/022_platform.sql", import.meta.url),
          "utf8",
        ),
      );
    }
    if (
      !(
        await admin.query(
          "SELECT to_regprocedure('retail.platform_existing_auth_users()') AS fn",
        )
      ).rows[0].fn
    ) {
      // Reproduce Supabase's SET-only owner membership without superuser power.
      await admin.query(
        "CREATE ROLE smartretail_migration_test NOLOGIN NOSUPERUSER NOBYPASSRLS; GRANT smartretail_owner TO smartretail_migration_test WITH INHERIT FALSE,SET TRUE; GRANT USAGE ON SCHEMA auth,retail TO smartretail_migration_test; GRANT SELECT(id,email) ON auth.users TO smartretail_migration_test",
      );
      const migration = await admin.connect();
      try {
        await migration.query(
          "SET SESSION AUTHORIZATION smartretail_migration_test",
        );
        await migration.query(
          await readFile(
            new URL(
              "../migrations/023_platform_auth_directory.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        expect(
          (
            await migration.query(
              "SELECT has_function_privilege('smartretail_app','retail.platform_existing_auth_users()','EXECUTE') AS historical_public",
            )
          ).rows[0].historical_public,
        ).toBe(true);
      } finally {
        await migration.query("ROLLBACK");
        await migration.query("RESET SESSION AUTHORIZATION");
        migration.release();
      }
    }
    await admin.query(
      await readFile(
        new URL("../migrations/024_platform_helper_acl.sql", import.meta.url),
        "utf8",
      ),
    );
    await admin.query(
      "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz DEFAULT clock_timestamp()",
    );
    if (
      !(await admin.query("SELECT to_regclass('retail.onboarding_commands') t"))
        .rows[0].t
    ) {
      await admin.query(
        await readFile(
          new URL(
            "../migrations/025_onboarding_invitations.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
    }
    if (
      !(await admin.query("SELECT to_regclass('retail.support_requests') t"))
        .rows[0].t
    ) {
      await admin.query(
        await readFile(
          new URL("../migrations/026_help_support.sql", import.meta.url),
          "utf8",
        ),
      );
    }
    if (
      !(await admin.query("SELECT to_regclass('retail.product_images') t"))
        .rows[0].t
    )
      await admin.query(
        await readFile(
          new URL("../migrations/027_product_images.sql", import.meta.url),
          "utf8",
        ),
      );
    // Reproduce the managed schema restriction, independently of column grants.
    await admin.query(
      "REVOKE USAGE ON SCHEMA auth FROM smartretail_platform_guard",
    );
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
      "TRUNCATE retail.product_image_audit,retail.product_images,retail.support_audit,retail.support_requests,retail.onboarding_audit,retail.invitation_locations,retail.tenant_invitations,retail.onboarding_commands,retail.platform_audit,retail.platform_admins,retail.settings_audit,retail.business_profiles,retail.payables_audit,retail.expenses,retail.payable_payments,retail.payables,retail.credit_audit,retail.receivable_payments,retail.receivable_adjustments,retail.receivables,retail.tax_profiles,retail.promotion_audit,retail.coupon_redemptions,retail.promotions,retail.coupons,retail.membership_audit,retail.member_locations,retail.inventory_minimum_audit,retail.inventory_minimums,retail.customer_audit,retail.customers,retail.purchasing_audit,retail.purchase_receipt_lines,retail.purchase_receipts,retail.purchase_order_lines,retail.purchase_orders,retail.suppliers,retail.audit_log,retail.sale_return_refunds,retail.sale_return_lines,retail.sale_returns,retail.suspended_sale_lines,retail.suspended_sales,retail.cash_movements,retail.cash_register_shifts,retail.sale_payments,retail.sale_lines,retail.sales,retail.inventory_counts,retail.inventory_commands,retail.inventory_transfers,retail.inventory_movements,retail.stock_balances,retail.inventory_locations,retail.products,retail.tenant_memberships,retail.tenants",
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
    await admin.query(
      "INSERT INTO retail.member_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3),($1,$2,$4)",
      [tenantA, clerkUser, source, destination],
    );
    await new PostgresCash(apiPool, {
      tenantId: tenantA,
      userId: ownerUser,
    }).openShift({ id: shiftId, locationId: source, openingCash: money(0n) });
    await receiveInventory(db, receipt());
  });

  describe("UX03D1 product image authorization", () => {
    const images = () =>
      new PostgresProductImages(apiPool, {
        tenantId: tenantA,
        userId: ownerUser,
      });
    it("writes exact scoped reference and durable audit", async () => {
      const id = randomUUID(),
        corr = randomUUID();
      await images().assertWrite(product, corr);
      await images().changeImage(product, null, id, corr);
      expect(await images().image(product)).toEqual({
        imageId: id,
        objectPath: tenantA + "/" + product + "/" + id + ".jpg",
      });
      const a = await admin.query(
        "SELECT operation,actor_user_id,correlation_id FROM retail.product_image_audit ORDER BY created_at",
      );
      expect(a.rows.map((r) => r.operation)).toEqual([
        "photo.change_attempt",
        "photo.replace",
      ]);
      expect(a.rows[1].actor_user_id).toBe(ownerUser);
      expect(a.rows[1].correlation_id).toBe(corr);
    });
    it("does not expose reference from another tenant", async () => {
      await images().changeImage(product, null, randomUUID(), randomUUID());
      await expect(
        new PostgresProductImages(apiPool, {
          tenantId: tenantB,
          userId: ownerUser,
        }).image(product),
      ).resolves.toBeNull();
    });
    it("cashier and clerk cannot write photos", async () => {
      for (const role of ["cashier", "inventory_clerk"]) {
        await admin.query(
          "UPDATE retail.tenant_memberships SET role=$1 WHERE tenant_id=$2 AND user_id=$3",
          [role, tenantA, clerkUser],
        );
        await expect(
          new PostgresProductImages(apiPool, {
            tenantId: tenantA,
            userId: clerkUser,
          }).assertWrite(product, randomUUID()),
        ).rejects.toBeInstanceOf(PermissionDeniedError);
      }
    });
    it("inactive membership cannot read/write", async () => {
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND user_id=$2",
        [tenantA, ownerUser],
      );
      await expect(images().image(product)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(
        images().assertWrite(product, randomUUID()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("concurrent replacement preserves one winner and audit", async () => {
      const concurrent = new Pool({
        ...apiPool.options,
        password: apiPool.options.password,
        max: 2,
      });
      const images = () =>
        new PostgresProductImages(concurrent, {
          tenantId: tenantA,
          userId: ownerUser,
        });
      try {
        const ids = [randomUUID(), randomUUID()];
        const r = await Promise.allSettled(
          ids.map((id) =>
            images().changeImage(product, null, id, randomUUID()),
          ),
        );
        expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
        const denied = r.find((x) => x.status === "rejected");
        expect(denied?.status === "rejected" && denied.reason).toBeInstanceOf(
          ProductImageConflictError,
        );
        expect(ids).toContain((await images().image(product))?.imageId);
        expect(
          (
            await admin.query(
              "SELECT count(*)::int n FROM retail.product_image_audit",
            )
          ).rows[0].n,
        ).toBe(1);
      } finally {
        await concurrent.end();
      }
    });
    it("deletes only current photo reference and preserves audit", async () => {
      const id = randomUUID();
      await images().changeImage(product, null, id, randomUUID());
      expect(await images().changeImage(product, id, null, randomUUID())).toBe(
        tenantA + "/" + product + "/" + id + ".jpg",
      );
      expect(await images().image(product)).toBeNull();
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.product_image_audit",
          )
        ).rows[0].n,
      ).toBe(2);
    });
    it("database constraints reject cross-tenant and traversal references", async () => {
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "INSERT INTO retail.product_images VALUES($1,$2,$3,$4,$5,clock_timestamp())",
            [tenantA, product, randomUUID(), "../other/image.jpg", ownerUser],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("blocks quota before storage work and records authorized attempts", async () => {
      await admin.query(
        "INSERT INTO retail.product_image_audit(tenant_id,product_id,actor_user_id,operation,correlation_id) SELECT $1,$2,$3,'photo.change_attempt',gen_random_uuid() FROM generate_series(1,60)",
        [tenantA, product, ownerUser],
      );
      await expect(
        images().assertWrite(product, randomUUID()),
      ).rejects.toBeInstanceOf(ProductImageRateLimitError);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.product_image_audit",
          )
        ).rows[0].n,
      ).toBe(60);
    });
    it("concurrent attempts at quota boundary allow exactly one", async () => {
      const concurrent = new Pool({
        ...apiPool.options,
        password: apiPool.options.password,
        max: 2,
      });
      const images = () =>
        new PostgresProductImages(concurrent, {
          tenantId: tenantA,
          userId: ownerUser,
        });
      try {
        await admin.query(
          "INSERT INTO retail.product_image_audit(tenant_id,product_id,actor_user_id,operation,correlation_id) SELECT $1,$2,$3,'photo.change_attempt',gen_random_uuid() FROM generate_series(1,59)",
          [tenantA, product, ownerUser],
        );
        const results = await Promise.allSettled([
          images().assertWrite(product, randomUUID()),
          images().assertWrite(product, randomUUID()),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(
          (
            await admin.query(
              "SELECT count(*)::int n FROM retail.product_image_audit",
            )
          ).rows[0].n,
        ).toBe(60);
      } finally {
        await concurrent.end();
      }
    });
    it("RLS denies direct image writes to another tenant", async () => {
      const id = randomUUID();
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "INSERT INTO retail.product_images VALUES($1,$2,$3,$4,$5,clock_timestamp())",
            [
              tenantB,
              product,
              id,
              tenantB + "/" + product + "/" + id + ".jpg",
              ownerUser,
            ],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("audit is immutable and unprivileged truncate is denied", async () => {
      await images().changeImage(product, null, randomUUID(), randomUUID());
      await expect(
        sql(tenantA, (c) => c.query("DELETE FROM retail.product_image_audit")),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        sql(tenantA, (c) => c.query("TRUNCATE retail.product_image_audit")),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
  describe("UX03C support and setup", () => {
    it("denies revoked platform authority and replay of another actor's ID", async () => {
      const v = input();
      await own().create(v, randomUUID());
      await expect(
        own(clerkUser).create(v, randomUUID()),
      ).rejects.toBeInstanceOf(SupportUnavailableError);
      await enablePlatform();
      await admin.query(
        "UPDATE retail.platform_admins SET active=false WHERE user_id=$1",
        [outsiderUser],
      );
      await expect(platform().list()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(
        platform().changeStatus(v.id, "closed", randomUUID()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("requires READ COMMITTED even through direct SQL", async () => {
      const c = await apiPool.connect();
      try {
        await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await c.query(
          "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
          [tenantA, ownerUser],
        );
        await expect(
          c.query(
            "SELECT retail.support_create($1,'error','Prueba','Texto','/cash',$2)",
            [randomUUID(), randomUUID()],
          ),
        ).rejects.toHaveProperty("code", "23514");
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
    const input = () => ({
      id: randomUUID(),
      category: "error" as const,
      subject: "SMOKE Caja",
      description: "<script>alert(1)</script>\nNo puedo abrir caja",
      pagePath: "/cash",
    });
    const own = (u = ownerUser, t = tenantA) =>
      new PostgresSupport(apiPool, u, t);
    const platform = () =>
      new PostgresSupport(apiPool, outsiderUser, undefined, true);
    const enablePlatform = () =>
      admin.query("INSERT INTO retail.platform_admins(user_id) VALUES($1)", [
        outsiderUser,
      ]);
    it("creates durable own request and minimal audit without description", async () => {
      const v = input(),
        r = await own().create(v, randomUUID());
      expect(r).toMatchObject({
        ...v,
        status: "open",
        tenantId: tenantA,
        createdByUserId: ownerUser,
      });
      const a = await admin.query(
        "SELECT * FROM retail.support_audit WHERE request_id=$1",
        [v.id],
      );
      expect(a.rows).toHaveLength(1);
      expect(JSON.stringify(a.rows)).not.toContain("<script>");
      expect((await own().list()).requests[0]?.id).toBe(v.id);
    });
    it("isolates two actors in the same tenant and arbitrary foreign IDs", async () => {
      const r = await own().create(input(), randomUUID());
      expect((await own(clerkUser).list()).requests).toEqual([]);
      await expect(own(clerkUser).detail(r.id)).rejects.toBeInstanceOf(
        SupportUnavailableError,
      );
      await expect(own().detail(randomUUID())).rejects.toBeInstanceOf(
        SupportUnavailableError,
      );
    });
    it("isolates A/B including forged tenant selectors", async () => {
      const r = await own().create(input(), randomUUID());
      expect((await own(ownerUser, tenantB).list()).requests).toEqual([]);
      await expect(own(ownerUser, tenantB).detail(r.id)).rejects.toBeInstanceOf(
        SupportUnavailableError,
      );
      await expect(own(clerkUser, tenantB).list()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
    it("denies inactive memberships on create, list and replay", async () => {
      const v = input();
      await own().create(v, randomUUID());
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND user_id=$2",
        [tenantA, ownerUser],
      );
      await expect(own().create(v, randomUUID())).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(own().list()).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("denies suspended tenant while authorized platform can resolve requests", async () => {
      const r = await own().create(input(), randomUUID());
      await enablePlatform();
      await admin.query(
        "UPDATE retail.tenants SET status='suspended' WHERE tenant_id=$1",
        [tenantA],
      );
      await expect(own().detail(r.id)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      expect(
        (await platform().changeStatus(r.id, "resolved", randomUUID())).status,
      ).toBe("resolved");
    });
    it("separates platform authority from owner and denies ordinary status changes", async () => {
      const r = await own().create(input(), randomUUID());
      await expect(
        new PostgresSupport(apiPool, ownerUser, undefined, true).list(),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        own().changeStatus(r.id, "closed", randomUUID()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await enablePlatform();
      expect((await platform().list()).requests[0]?.id).toBe(r.id);
      expect((await platform().detail(r.id)).description).toContain("<script>");
    });
    it("replays concurrent submissions exactly once with immutable payload", async () => {
      const v = input();
      const results = await Promise.all([
        own().create(v, randomUUID()),
        own().create(v, randomUUID()),
      ]);
      expect(results[0]?.id).toBe(results[1]?.id);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.support_audit WHERE request_id=$1",
            [v.id],
          )
        ).rows[0].n,
      ).toBe(1);
      await expect(
        own().create({ ...v, subject: "Otro asunto" }, randomUUID()),
      ).rejects.toBeInstanceOf(SupportConflictError);
    });
    it("conflicting concurrent submissions produce one conflict", async () => {
      const v = input();
      const results = await Promise.allSettled([
        own().create(v, randomUUID()),
        own().create({ ...v, description: "Otra intención" }, randomUUID()),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        results.some(
          (r) =>
            r.status === "rejected" && r.reason instanceof SupportConflictError,
        ),
      ).toBe(true);
    });
    it("replay after platform status change preserves status and audit", async () => {
      const v = input();
      await own().create(v, randomUUID());
      await enablePlatform();
      for (const status of ["in_progress", "resolved", "closed"] as const)
        await platform().changeStatus(v.id, status, randomUUID());
      expect((await own().create(v, randomUUID())).status).toBe("closed");
      await platform().changeStatus(v.id, "closed", randomUUID());
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.support_audit WHERE request_id=$1",
            [v.id],
          )
        ).rows[0].n,
      ).toBe(4);
    });
    it("database enforces text bounds, path whitelist and hourly limit", async () => {
      await expect(
        own().create(
          { ...input(), description: "x".repeat(4001) },
          randomUUID(),
        ),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        own().create(
          { ...input(), pagePath: "/cash?token=secret" },
          randomUUID(),
        ),
      ).rejects.toBeInstanceOf(TypeError);
      const v = input();
      await own().create(v, randomUUID());
      for (let n = 0; n < 18; n++) await own().create(input(), randomUUID());
      const boundary = await Promise.allSettled([
        own().create(input(), randomUUID()),
        own().create(input(), randomUUID()),
      ]);
      expect(boundary.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        boundary.some(
          (r) =>
            r.status === "rejected" &&
            r.reason instanceof SupportRateLimitError,
        ),
      ).toBe(true);
      await expect(own().create(input(), randomUUID())).rejects.toBeInstanceOf(
        SupportRateLimitError,
      );
      expect((await own().create(v, randomUUID())).id).toBe(v.id);
    });
    it("RLS FORCE and direct runtime privileges cannot mutate or bypass support", async () => {
      const r = await own().create(input(), randomUUID());
      const c = await apiPool.connect();
      try {
        await c.query("BEGIN");
        await c.query(
          "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
          [tenantA, clerkUser],
        );
        expect(
          (await c.query("SELECT id FROM retail.support_requests")).rows,
        ).toEqual([]);
        await expect(
          c.query(
            "UPDATE retail.support_requests SET status='closed' WHERE id=$1",
            [r.id],
          ),
        ).rejects.toHaveProperty("code", "42501");
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
      const a = await admin.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN('retail.support_requests'::regclass,'retail.support_audit'::regclass)",
      );
      for (const statement of [
        "INSERT INTO retail.support_requests DEFAULT VALUES",
        "DELETE FROM retail.support_requests",
        "TRUNCATE retail.support_requests",
        "SELECT * FROM retail.support_audit",
      ])
        await expect(apiPool.query(statement)).rejects.toHaveProperty(
          "code",
          "42501",
        );
      expect(
        a.rows.every((x) => x.relrowsecurity && x.relforcerowsecurity),
      ).toBe(true);
      expect(
        (
          await admin.query(
            "SELECT has_function_privilege('smartretail_api','retail.support_summary(retail.support_requests)','EXECUTE') allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
    });
    it("derives setup progress from real server records and restricts operational roles", async () => {
      const r = await own().initialSetup();
      expect(r).toMatchObject({
        company: true,
        branch: true,
        product: true,
        inventory: true,
        cash: true,
        sale: false,
        team: true,
        taxes: false,
      });
      await expect(own(clerkUser).initialSetup()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
  });
  describe("TASK-032 onboarding and invitations", () => {
    const newUser = "550e8400-e29b-41d4-a716-446655440090",
      unverified = "550e8400-e29b-41d4-a716-446655440091";
    const repo = (user = ownerUser) => new PostgresOnboarding(apiPool, user);
    const intent = () => ({
      commandId: randomUUID(),
      businessName: "SMOKE Empresa",
      tradeName: "Mi tienda",
      phone: null,
      email: null,
      branchName: "Sucursal Centro",
    });
    const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
    const create = async (
      address = "new@example.test",
      locations: string[] = [source],
      role = "cashier",
    ) => {
      const tokenHash = hash();
      const invitation = await repo().create(
        tenantA,
        { email: address, role, locationIds: locations, expiresInDays: 7 },
        tokenHash,
        randomUUID(),
      );
      return { tokenHash, invitation };
    };
    beforeEach(async () => {
      await admin.query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'owner@example.test',clock_timestamp()),($2,'admin@example.test',clock_timestamp()),($3,'new@example.test',clock_timestamp()),($4,'unverified@example.test',NULL),($5,'clerk@example.test',clock_timestamp()) ON CONFLICT(id) DO UPDATE SET email=excluded.email,email_confirmed_at=excluded.email_confirmed_at",
        [ownerUser, adminUser, newUser, unverified, clerkUser],
      );
    });
    it("creates owner, profile, active first branch and audit atomically without commercial data", async () => {
      const result = await repo(newUser).onboard(intent(), randomUUID());
      const members = await listTenantMemberships(apiPool, newUser);
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({
        tenantId: result.tenantId,
        role: "owner",
        allLocations: true,
      });
      expect(
        (
          await admin.query(
            "SELECT business_name,trade_name,currency FROM retail.business_profiles WHERE tenant_id=$1",
            [result.tenantId],
          )
        ).rows[0],
      ).toMatchObject({
        business_name: "SMOKE Empresa",
        trade_name: "Mi tienda",
        currency: "MXN",
      });
      expect(
        (
          await admin.query(
            "SELECT name,status FROM retail.inventory_locations WHERE tenant_id=$1 AND id=$2",
            [result.tenantId, result.locationId],
          )
        ).rows[0],
      ).toEqual({ name: "Sucursal Centro", status: "active" });
      expect(
        await new PostgresInventory(apiPool, {
          userId: newUser,
          tenantId: result.tenantId,
        }).listProducts(),
      ).toEqual([]);
    });
    it("requires verified Auth email for onboarding", async () => {
      await expect(
        repo(unverified).onboard(intent(), randomUUID()),
      ).rejects.toThrow(PermissionDeniedError);
    });
    it("rejects unknown Auth identity and forged actor context", async () => {
      await expect(
        repo(randomUUID()).onboard(intent(), randomUUID()),
      ).rejects.toThrow(PermissionDeniedError);
    });
    it("existing members cannot self-create another company including inactive memberships", async () => {
      await expect(repo().onboard(intent(), randomUUID())).rejects.toThrow(
        OnboardingConflictError,
      );
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE user_id=$1",
        [ownerUser],
      );
      await expect(repo().onboard(intent(), randomUUID())).rejects.toThrow(
        OnboardingConflictError,
      );
    });
    it("replays identical onboarding without duplicate company or audit", async () => {
      const body = intent(),
        first = await repo(newUser).onboard(body, randomUUID());
      expect(await repo(newUser).onboard(body, randomUUID())).toEqual(first);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.onboarding_audit WHERE tenant_id=$1",
            [first.tenantId],
          )
        ).rows[0].n,
      ).toBe(2);
    });
    it("same command with changed intent conflicts", async () => {
      const body = intent();
      await repo(newUser).onboard(body, randomUUID());
      await expect(
        repo(newUser).onboard({ ...body, branchName: "Otra" }, randomUUID()),
      ).rejects.toThrow(OnboardingConflictError);
    });
    it("different command cannot create a second business", async () => {
      await repo(newUser).onboard(intent(), randomUUID());
      await expect(
        repo(newUser).onboard(intent(), randomUUID()),
      ).rejects.toThrow(OnboardingConflictError);
    });
    it("concurrent identical onboarding returns one durable result", async () => {
      const body = intent(),
        adapter = new PostgresOnboarding(pool, newUser);
      const results = await Promise.all([
        adapter.onboard(body, randomUUID()),
        adapter.onboard(body, randomUUID()),
      ]);
      expect(results[0]).toEqual(results[1]);
    });
    it("concurrent different commands admit exactly one company", async () => {
      const adapter = new PostgresOnboarding(pool, newUser);
      const results = await Promise.allSettled([
        adapter.onboard(intent(), randomUUID()),
        adapter.onboard(intent(), randomUUID()),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await listTenantMemberships(apiPool, newUser)).toHaveLength(1);
    });
    it("invalid profile rolls back all onboarding writes", async () => {
      await expect(
        repo(newUser).onboard({ ...intent(), email: "invalid" }, randomUUID()),
      ).rejects.toThrow(TypeError);
      expect(await listTenantMemberships(apiPool, newUser)).toEqual([]);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.onboarding_commands",
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("suspended company blocks onboarding replay without losing history", async () => {
      const body = intent(),
        first = await repo(newUser).onboard(body, randomUUID());
      await admin.query(
        "UPDATE retail.tenants SET status='suspended' WHERE tenant_id=$1",
        [first.tenantId],
      );
      await expect(repo(newUser).onboard(body, randomUUID())).rejects.toThrow(
        PermissionDeniedError,
      );
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.onboarding_commands",
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("self-service company appears in platform with origin but grants no platform role", async () => {
      const first = await repo(newUser).onboard(intent(), randomUUID());
      await admin.query(
        "INSERT INTO retail.platform_admins(user_id) VALUES($1)",
        [ownerUser],
      );
      expect(
        (await new PostgresPlatform(apiPool, ownerUser).detail(first.tenantId))
          .origin,
      ).toBe("self-service");
      expect(await new PostgresPlatform(apiPool, newUser).access()).toBe(false);
      await expect(
        new PostgresPlatform(apiPool, newUser).list(),
      ).rejects.toThrow(PermissionDeniedError);
      await expect(
        new PostgresInventory(apiPool, {
          userId: newUser,
          tenantId: tenantA,
        }).listProducts(),
      ).rejects.toThrow(PermissionDeniedError);
    });
    it("creates bounded invitation and list exposes no token hash", async () => {
      const { tokenHash, invitation } = await create();
      expect(invitation).toMatchObject({
        role: "cashier",
        locationIds: [source],
        acceptedAt: null,
        revokedAt: null,
      });
      expect(
        JSON.stringify(await repo().list(tenantA, randomUUID())),
      ).not.toContain(tokenHash);
      expect(
        (
          await admin.query(
            "SELECT token_hash FROM retail.tenant_invitations WHERE id=$1",
            [invitation.id],
          )
        ).rows[0].token_hash,
      ).toBe(tokenHash);
    });
    it("clerk and foreign scope cannot create or list invitations", async () => {
      for (const user of [clerkUser, newUser])
        await expect(repo(user).list(tenantA, randomUUID())).rejects.toThrow(
          PermissionDeniedError,
        );
      await expect(
        repo(adminUser).create(
          tenantB,
          {
            email: "new@example.test",
            role: "cashier",
            locationIds: [],
            expiresInDays: 7,
          },
          hash(),
          randomUUID(),
        ),
      ).rejects.toThrow(PermissionDeniedError);
    });
    it("admin cannot grant owner even by direct SQL function", async () => {
      await expect(
        repo(adminUser).create(
          tenantA,
          {
            email: "new@example.test",
            role: "owner",
            locationIds: [],
            expiresInDays: 7,
          },
          hash(),
          randomUUID(),
        ),
      ).rejects.toThrow(TypeError);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.tenant_invitations",
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("rejects foreign, inactive and duplicate location assignments", async () => {
      const foreign = randomUUID();
      await admin.query(
        "INSERT INTO retail.inventory_locations(tenant_id,id,code,name,status) VALUES($1,$2,'OTHER','Other','active')",
        [tenantB, foreign],
      );
      await expect(create("new@example.test", [foreign])).rejects.toThrow(
        PermissionDeniedError,
      );
      await expect(
        create("new@example.test", [source, source]),
      ).rejects.toThrow(TypeError);
      await admin.query(
        "UPDATE retail.inventory_locations SET status='inactive' WHERE tenant_id=$1 AND id=$2",
        [tenantA, source],
      );
      await expect(create()).rejects.toThrow(PermissionDeniedError);
    });
    it("matching verified existing Auth user accepts assigned role and locations", async () => {
      const { tokenHash } = await create();
      expect(await repo(newUser).accept(tokenHash, randomUUID())).toEqual({
        tenantId: tenantA,
      });
      expect((await listTenantMemberships(apiPool, newUser))[0]).toMatchObject({
        role: "cashier",
        locationIds: [source],
        allLocations: false,
      });
    });
    it("stolen token cannot be used by another verified email", async () => {
      const { tokenHash } = await create();
      await expect(
        repo(adminUser).accept(tokenHash, randomUUID()),
      ).rejects.toThrow(PermissionDeniedError);
      expect(
        (await repo().list(tenantA, randomUUID()))[0]?.acceptedAt,
      ).toBeNull();
    });
    it("unverified invited email cannot accept", async () => {
      const { tokenHash } = await create("unverified@example.test");
      await expect(
        repo(unverified).accept(tokenHash, randomUUID()),
      ).rejects.toThrow(PermissionDeniedError);
    });
    it("single-use token rejects replay and concurrent acceptance", async () => {
      const { tokenHash } = await create(),
        adapter = new PostgresOnboarding(pool, newUser);
      const results = await Promise.allSettled([
        adapter.accept(tokenHash, randomUUID()),
        adapter.accept(tokenHash, randomUUID()),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await expect(
        repo(newUser).accept(tokenHash, randomUUID()),
      ).rejects.toThrow(OnboardingConflictError);
    });
    it("expired invitation and unknown hash are unavailable", async () => {
      const { tokenHash } = await create();
      await admin.query(
        "UPDATE retail.tenant_invitations SET created_at=clock_timestamp()-interval '8 days',expires_at=clock_timestamp()-interval '1 day'",
      );
      await expect(
        repo(newUser).accept(tokenHash, randomUUID()),
      ).rejects.toThrow(OnboardingConflictError);
      await expect(repo(newUser).accept(hash(), randomUUID())).rejects.toThrow(
        InvitationUnavailableError,
      );
    });
    it("revocation is idempotent, tenant scoped and prevents acceptance", async () => {
      const { tokenHash, invitation } = await create();
      await expect(
        repo().revoke(tenantB, invitation.id, randomUUID()),
      ).rejects.toThrow(InvitationUnavailableError);
      await repo().revoke(tenantA, invitation.id, randomUUID());
      await repo().revoke(tenantA, invitation.id, randomUUID());
      await expect(
        repo(newUser).accept(tokenHash, randomUUID()),
      ).rejects.toThrow(OnboardingConflictError);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.onboarding_audit WHERE operation='invitation.revoked'",
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("acceptance supports multiple companies without replacing existing or inactive access", async () => {
      await admin.query(
        "INSERT INTO retail.tenant_memberships(tenant_id,user_id,role,status) VALUES($1,$2,'inventory_clerk','active')",
        [tenantB, newUser],
      );
      const { tokenHash } = await create();
      await repo(newUser).accept(tokenHash, randomUUID());
      expect(await listTenantMemberships(apiPool, newUser)).toHaveLength(2);
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND user_id=$2",
        [tenantA, newUser],
      );
      const again = await create();
      await expect(
        repo(newUser).accept(again.tokenHash, randomUUID()),
      ).rejects.toThrow(OnboardingConflictError);
    });
    it("suspended company and newly inactive assigned branch block acceptance", async () => {
      const { tokenHash } = await create();
      await admin.query(
        "UPDATE retail.tenants SET status='suspended' WHERE tenant_id=$1",
        [tenantA],
      );
      await expect(
        repo(newUser).accept(tokenHash, randomUUID()),
      ).rejects.toThrow(PermissionDeniedError);
      await expect(create()).rejects.toThrow(PermissionDeniedError);
      await admin.query(
        "UPDATE retail.tenants SET status='active' WHERE tenant_id=$1",
        [tenantA],
      );
      await admin.query(
        "UPDATE retail.inventory_locations SET status='inactive' WHERE tenant_id=$1 AND id=$2",
        [tenantA, source],
      );
      await expect(
        repo(newUser).accept(tokenHash, randomUUID()),
      ).rejects.toThrow(OnboardingConflictError);
    });
    it("runtime has no direct membership, private helper, token table or audit write access", async () => {
      for (const query of [
        "SELECT retail.onboarding_auth_email()",
        "SELECT * FROM retail.tenant_invitations",
        "SELECT * FROM retail.onboarding_commands",
        "DELETE FROM retail.onboarding_audit",
        `INSERT INTO retail.tenant_memberships(tenant_id,user_id,role,status) VALUES('${tenantA}','${newUser}','owner','active')`,
      ])
        await expect(sql(tenantA, (c) => c.query(query))).rejects.toMatchObject(
          { code: "42501" },
        );
      const { tokenHash } = await create();
      await repo(newUser).accept(tokenHash, randomUUID());
      expect(
        (
          await admin.query(
            "SELECT operation FROM retail.onboarding_audit ORDER BY created_at",
          )
        ).rows.map((r) => r.operation),
      ).toEqual(["invitation.created", "invitation.accepted"]);
      await expect(
        sql(
          tenantA,
          (c) =>
            c.query(
              "SELECT retail.create_invitation($1,'owner','{}',7,$2,$3)",
              ["new@example.test", hash(), randomUUID()],
            ),
          adminUser,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("rejects stale authorization snapshots at SQL entry points", async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await c.query("SELECT set_config('app.user_id',$1,true)", [newUser]);
        await expect(
          c.query("SELECT retail.accept_invitation($1,$2)", [
            hash(),
            randomUUID(),
          ]),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
    it("rechecks email after waiting and actually locks branches against concurrent deactivation", async () => {
      const { tokenHash, invitation } = await create();
      async function waitForLock() {
        for (let attempt = 0; attempt < 150; attempt++) {
          const result = await admin.query(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%accept_invitation%'",
          );
          if (result.rows[0].n > 0) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Acceptance did not acquire the expected lock");
      }
      const blocker = await admin.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM retail.tenant_invitations WHERE id=$1 FOR UPDATE",
          [invitation.id],
        );
        const pending = repo(newUser)
          .accept(tokenHash, randomUUID())
          .then(
            () => null,
            (e) => e as unknown,
          );
        await waitForLock();
        await admin.query(
          "UPDATE auth.users SET email='changed@example.test' WHERE id=$1",
          [newUser],
        );
        await blocker.query("COMMIT");
        expect(await pending).toBeInstanceOf(PermissionDeniedError);
        await admin.query(
          "UPDATE auth.users SET email='new@example.test' WHERE id=$1",
          [newUser],
        );
        await blocker.query("BEGIN");
        await blocker.query(
          "UPDATE retail.inventory_locations SET status='inactive' WHERE tenant_id=$1 AND id=$2",
          [tenantA, source],
        );
        const second = repo(newUser)
          .accept(tokenHash, randomUUID())
          .then(
            () => null,
            (e) => e as unknown,
          );
        await waitForLock();
        await blocker.query("COMMIT");
        expect(await second).toBeInstanceOf(OnboardingConflictError);
        await admin.query(
          "UPDATE retail.inventory_locations SET status='active' WHERE tenant_id=$1 AND id=$2",
          [tenantA, source],
        );
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM retail.inventory_locations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenantA, source],
        );
        const changedEmail = repo(newUser)
          .accept(tokenHash, randomUUID())
          .then(
            () => null,
            (e) => e as unknown,
          );
        await waitForLock();
        await admin.query(
          "UPDATE auth.users SET email='changed@example.test' WHERE id=$1",
          [newUser],
        );
        await blocker.query("COMMIT");
        expect(await changedEmail).toBeInstanceOf(PermissionDeniedError);
        await admin.query(
          "UPDATE auth.users SET email='new@example.test' WHERE id=$1",
          [newUser],
        );
        await admin.query(
          "UPDATE retail.tenant_invitations SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",
          [invitation.id],
        );
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM retail.inventory_locations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenantA, source],
        );
        const expired = repo(newUser)
          .accept(tokenHash, randomUUID())
          .then(
            () => null,
            (e) => e as unknown,
          );
        await waitForLock();
        await admin.query("SELECT pg_sleep(1.1)");
        await blocker.query("COMMIT");
        expect(await expired).toBeInstanceOf(OnboardingConflictError);
        expect(await listTenantMemberships(apiPool, newUser)).toEqual([]);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
    });
  });

  describe("TASK-028 credit and collections", () => {
    const customers = (userId = ownerUser, tenantId = tenantA) =>
      new PostgresCustomers(apiPool, { userId, tenantId });
    const accounts = (userId = ownerUser, tenantId = tenantA) =>
      new PostgresReceivables(apiPool, { userId, tenantId });
    const sales = () =>
      new PostgresSales(pool, { userId: ownerUser, tenantId: tenantA });
    const returns = () =>
      new PostgresSaleReturns(pool, { userId: ownerUser, tenantId: tenantA });
    const cashier = "550e8400-e29b-41d4-a716-446655440025";
    const mxn = (minorUnits: string) => money(BigInt(minorUnits));
    async function customer(limit: bigint | null = 10000n) {
      return customers().createCustomer(randomUUID(), {
        name: "SMOKE Credit",
        status: "active",
        creditEnabled: true,
        ...(limit === null ? {} : { creditLimit: money(limit) }),
      });
    }
    function command(
      cid?: string,
      credit = 6000n,
      location = source,
      shift = shiftId,
    ): SaleCheckoutInput {
      const draft = addSaleProduct(
        createSaleDraft(randomUUID(), cid),
        fixtureProduct(),
        quantity("piece", 3000n),
      );
      return {
        draft,
        locationId: location,
        shiftId: shift,
        payments: [
          ...(credit < 6000n
            ? [{ method: "cash" as const, amount: money(6000n - credit) }]
            : []),
          ...(credit > 0n
            ? [{ method: "credit" as const, amount: money(credit) }]
            : []),
        ],
        movements: [{ productId: product, movementId: randomUUID() }],
      };
    }
    async function sold(credit = 6000n, limit: bigint | null = 10000n) {
      const c = await customer(limit),
        input = command(c.id, credit);
      const sale = await completeSaleTransaction(sales(), input);
      return { c, input, sale, rid: sale.recorded.sale.id };
    }
    const card = (value = "1000", id = randomUUID()) => ({
      id,
      method: "card" as const,
      amount: mxn(value),
    });
    const cash = (value = "1000", id = randomUUID(), shift = shiftId) => ({
      id,
      method: "cash" as const,
      amount: mxn(value),
      shiftId: shift,
    });
    const returnInput = (
      quantityMilli = 1000n,
      refunds: SaleReturnInput["refunds"] = [],
    ): SaleReturnInput => ({
      id: randomUUID(),
      lines: [
        {
          saleLineId: product,
          productId: product,
          quantity: quantity("piece", quantityMilli),
          movementId: randomUUID(),
        },
      ],
      refunds,
    });
    async function allowCashier() {
      await admin.query(
        "INSERT INTO retail.tenant_memberships(tenant_id,user_id,role,status) VALUES($1,$2,'cashier','active')",
        [tenantA, cashier],
      );
      await admin.query(
        "INSERT INTO retail.member_locations VALUES($1,$2,$3)",
        [tenantA, cashier, source],
      );
    }
    async function debt(id: string) {
      return (await accounts().read(id)).receivable.outstandingAmount
        .minorUnits;
    }
    it("default disabled; owner updates enabled limit and clears limit", async () => {
      const c = await customers().createCustomer(randomUUID(), {
        name: "Default",
        status: "active",
      });
      expect(c.creditEnabled).toBe(false);
      await expect(
        customers().updateCustomer(c.id, {
          creditLimit: money(9223372036854775808n),
        }),
      ).rejects.toBeInstanceOf(RangeError);
      expect(
        (
          await customers().updateCustomer(c.id, {
            creditEnabled: true,
            creditLimit: money(1n),
          })
        ).creditLimit,
      ).toEqual(money(1n));
      expect(
        (await customers().updateCustomer(c.id, { creditLimit: null }))
          .creditLimit,
      ).toBeUndefined();
    });
    it("cashier cannot enable or configure credit through CRUD or direct SQL", async () => {
      await allowCashier();
      const c = await customer();
      await expect(
        customers(cashier).updateCustomer(c.id, { creditLimit: money(20000n) }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        customers(cashier).createCustomer(randomUUID(), {
          name: "Escalation",
          status: "active",
          creditEnabled: true,
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        sql(
          tenantA,
          (client) =>
            client.query(
              "UPDATE retail.customers SET credit_enabled=false WHERE id=$1",
              [c.id],
            ),
          cashier,
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("pure and mixed credit create exact receivable without increasing cash credit", async () => {
      const { rid } = await sold(4000n);
      const account = (await accounts().read(rid)).receivable;
      expect(account.originalAmount.minorUnits).toBe("4000");
      expect(account.status).toBe("open");
      expect(
        (
          await new PostgresCash(apiPool, {
            userId: ownerUser,
            tenantId: tenantA,
          }).currentShift(source)
        )?.expectedCash.minorUnits,
      ).toBe(2000n);
    });
    it("general public disabled inactive missing foreign customer fail without stock writes", async () => {
      const c = await customer();
      await customers().updateCustomer(c.id, { creditEnabled: false });
      const foreign = await customers(ownerUser, tenantB).createCustomer(
        randomUUID(),
        { name: "Foreign", status: "active", creditEnabled: true },
      );
      for (const id of [undefined, c.id, foreign.id, randomUUID()])
        await expect(
          completeSaleTransaction(sales(), command(id)),
        ).rejects.toThrow();
      await customers().updateCustomer(c.id, {
        creditEnabled: true,
        status: "inactive",
      });
      await expect(
        completeSaleTransaction(sales(), command(c.id)),
      ).rejects.toThrow();
      expect(await stock()).toBe(10000n);
      expect(await accounts().list()).toHaveLength(0);
    });
    it("limit equality allowed; excess denied; no configured limit supported", async () => {
      const c = await customer(6000n);
      await completeSaleTransaction(sales(), command(c.id));
      await expect(
        completeSaleTransaction(sales(), command(c.id, 1n)),
      ).rejects.toThrow();
      const unbounded = await customer(null);
      await completeSaleTransaction(sales(), command(unbounded.id));
    });
    it("replay same SaleId preserves account after disabling credit", async () => {
      const { c, input, rid } = await sold();
      await customers().updateCustomer(c.id, { creditEnabled: false });
      expect((await completeSaleTransaction(sales(), input)).replayed).toBe(
        true,
      );
      expect(await debt(rid)).toBe("6000");
      expect(await accounts().list()).toHaveLength(1);
      await expect(
        completeSaleTransaction(sales(), {
          ...input,
          payments: [{ method: "cash", amount: money(6000n) }],
        }),
      ).rejects.toBeInstanceOf(SaleIdempotencyConflictError);
    });
    it("cash collection links cash_in and audit once; replay even when closed", async () => {
      const { rid } = await sold();
      const input = cash();
      await accounts().collect(rid, input, randomUUID());
      expect(await debt(rid)).toBe("5000");
      const cashierRepo = new PostgresCash(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      });
      expect(
        (await cashierRepo.currentShift(source))?.expectedCash.minorUnits,
      ).toBe(1000n);
      await cashierRepo.closeShift(shiftId, money(1000n));
      expect(
        (await accounts().collect(rid, input, randomUUID())).replayed,
      ).toBe(true);
      expect(
        (
          await admin.query(
            "SELECT count(*)::text n FROM retail.cash_movements WHERE receivable_payment_id=$1",
            [input.id],
          )
        ).rows[0]?.n,
      ).toBe("1");
    });
    it("card collection reduces debt without physical cash", async () => {
      const { rid } = await sold();
      await accounts().collect(rid, card(), randomUUID());
      expect(await debt(rid)).toBe("5000");
      expect(
        (
          await new PostgresCash(apiPool, {
            userId: ownerUser,
            tenantId: tenantA,
          }).currentShift(source)
        )?.expectedCash.minorUnits,
      ).toBe(0n);
    });
    it("same PaymentId different amount method account actor conflicts", async () => {
      const { rid } = await sold();
      const input = card();
      await accounts().collect(rid, input, randomUUID());
      for (const changed of [
        { ...input, amount: mxn("2") },
        cash("1000", input.id),
      ])
        await expect(
          accounts().collect(rid, changed, randomUUID()),
        ).rejects.toThrow();
      const other = await sold(1000n);
      await expect(
        accounts().collect(other.rid, input, randomUUID()),
      ).rejects.toThrow();
      await allowCashier();
      await expect(
        accounts(cashier).collect(rid, input, randomUUID()),
      ).rejects.toThrow();
      expect(await debt(rid)).toBe("5000");
    });
    it("overpayment zero negatives rejected; full payment derives liquidated", async () => {
      const { rid } = await sold();
      for (const value of ["6001", "0", "-1"])
        await expect(
          accounts().collect(rid, card(value), randomUUID()),
        ).rejects.toThrow();
      await accounts().collect(rid, card("6000"), randomUUID());
      expect((await accounts().read(rid)).receivable.status).toBe("paid");
    });
    it("cash requires matching open branch and rolls back missing or closed shift", async () => {
      const { rid } = await sold();
      await expect(
        accounts().collect(
          rid,
          cash("1", randomUUID(), randomUUID()),
          randomUUID(),
        ),
      ).rejects.toThrow();
      await new PostgresCash(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      }).closeShift(shiftId, money(0n));
      await expect(
        accounts().collect(rid, cash(), randomUUID()),
      ).rejects.toThrow();
      expect(await debt(rid)).toBe("6000");
      expect((await accounts().read(rid)).payments).toHaveLength(0);
    });
    it("cashier read/pay allowed while clerk inactive and tenant outsider denied", async () => {
      const { rid } = await sold();
      await allowCashier();
      await accounts(cashier).collect(rid, card("1"), randomUUID());
      await expect(accounts(clerkUser).list()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(
        accounts(ownerUser, tenantB).read(rid),
      ).rejects.toBeInstanceOf(SaleNotFoundError);
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE user_id=$1",
        [cashier],
      );
      await expect(
        accounts(cashier).collect(rid, card(), randomUUID()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("return reduces original sale debt first and never creates money refund", async () => {
      const { rid } = await sold(4000n);
      const result = await returns().returnSale(rid, returnInput());
      expect(result.record.total.minorUnits).toBe(2000n);
      expect(result.record.debtReduction?.minorUnits).toBe(2000n);
      expect(result.record.refunds).toHaveLength(0);
      expect(await debt(rid)).toBe("2000");
    });
    it("return excess refundable only by real collected method absent original tender", async () => {
      const { rid } = await sold();
      await accounts().collect(rid, card("5000"), randomUUID());
      const result = await returns().returnSale(
        rid,
        returnInput(1000n, [{ method: "card", amount: money(1000n) }]),
      );
      expect(result.record.debtReduction?.minorUnits).toBe(1000n);
      expect(await debt(rid)).toBe("0");
      await expect(
        returns().returnSale(rid, {
          ...returnInput(1000n, [{ method: "cash", amount: money(2000n) }]),
          shiftId,
          cashMovementId: randomUUID(),
        }),
      ).rejects.toThrow();
    });
    it("full return after partial payment closes exact debt refund and stock", async () => {
      const { rid } = await sold();
      await accounts().collect(rid, card("2501"), randomUUID());
      const input = returnInput(3000n, [
          { method: "card", amount: money(2501n) },
        ]),
        result = await returns().returnSale(rid, input);
      expect(result.record.debtReduction?.minorUnits).toBe(3499n);
      expect(await debt(rid)).toBe("0");
      expect(await stock()).toBe(10000n);
      expect((await returns().returnSale(rid, input)).replayed).toBe(true);
    });
    it("disabling or lowering customer limit preserves collections and historical reference", async () => {
      const { c, rid } = await sold();
      await customers().updateCustomer(c.id, {
        creditEnabled: false,
        status: "inactive",
        creditLimit: money(1n),
      });
      await accounts().collect(rid, card(), randomUUID());
      expect(await debt(rid)).toBe("5000");
      expect((await customers().readCustomer(c.id)).sales[0]?.id).toBe(rid);
    });
    it("accounts ledger/audit FORCE RLS and runtime cannot change balance or original", async () => {
      const { rid } = await sold();
      const tables = [
        "receivables",
        "receivable_payments",
        "receivable_adjustments",
        "credit_audit",
      ];
      expect(
        (
          await admin.query(
            "SELECT count(*)::text n FROM pg_class WHERE relname=ANY($1) AND relrowsecurity AND relforcerowsecurity",
            [tables],
          )
        ).rows[0]?.n,
      ).toBe("4");
      for (const query of [
        "UPDATE retail.receivables SET outstanding_minor_units=0",
        "DELETE FROM retail.receivables",
        "INSERT INTO retail.receivable_payments(id,tenant_id,receivable_id,location_id,method,amount_minor_units,created_by,command_payload) VALUES(gen_random_uuid(),$1,$2,$3,'card',1,$4,'{}')",
        "DELETE FROM retail.credit_audit",
      ])
        await expect(
          sql(tenantA, (c) =>
            c.query(
              query,
              query.includes("$1") ? [tenantA, rid, source, ownerUser] : [],
            ),
          ),
        ).rejects.toMatchObject({ code: "42501" });
      expect(await debt(rid)).toBe("6000");
    });
    it("cashier cannot read audit or unassigned account while global summary includes other branches", async () => {
      await allowCashier();
      const c = await customer(6000n);
      const otherShift = randomUUID();
      await new PostgresCash(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      }).openShift({
        id: otherShift,
        locationId: destination,
        openingCash: money(0n),
      });
      await receiveInventory(db, { ...receipt(), locationId: destination });
      await completeSaleTransaction(
        sales(),
        command(c.id, 6000n, destination, otherShift),
      );
      expect(await accounts(cashier).list()).toHaveLength(0);
      expect((await accounts(cashier).summary(c.id)).minorUnits).toBe("6000");
      await expect(
        completeSaleTransaction(
          new PostgresSales(pool, { userId: cashier, tenantId: tenantA }),
          command(c.id, 1n),
        ),
      ).rejects.toThrow();
      expect(
        await sql(
          tenantA,
          (c) => c.query("SELECT * FROM retail.credit_audit"),
          cashier,
        ).then((r) => r.rows),
      ).toHaveLength(0);
    });
    it("simultaneous two credit sales cannot exceed customer limit", async () => {
      const c = await customer(6000n);
      const results = await Promise.allSettled([
        completeSaleTransaction(sales(), command(c.id)),
        completeSaleTransaction(sales(), command(c.id)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await accounts().summary(c.id)).minorUnits).toBe("6000");
      expect(await stock()).toBe(7000n);
    });
    it("concurrent distinct payments serialize and cannot overpay", async () => {
      const { rid } = await sold();
      const repo = new PostgresReceivables(pool, {
        userId: ownerUser,
        tenantId: tenantA,
      });
      const result = await Promise.allSettled([
        repo.collect(rid, card("4000"), randomUUID()),
        repo.collect(rid, card("4000"), randomUUID()),
      ]);
      expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await debt(rid)).toBe("2000");
    });
    it("concurrent same payment ID returns one commit and replay", async () => {
      const { rid } = await sold();
      const repo = new PostgresReceivables(pool, {
          userId: ownerUser,
          tenantId: tenantA,
        }),
        input = card();
      const result = await Promise.all([
        repo.collect(rid, input, randomUUID()),
        repo.collect(rid, input, randomUUID()),
      ]);
      expect(result.filter((r) => r.replayed)).toHaveLength(1);
      expect((await accounts().read(rid)).payments).toHaveLength(1);
    });
    it("collection and return conserve debt regardless of commit ordering", async () => {
      const { rid } = await sold();
      const repo = new PostgresReceivables(pool, {
        userId: ownerUser,
        tenantId: tenantA,
      });
      await Promise.all([
        repo.collect(rid, card("1000"), randomUUID()),
        returns().returnSale(rid, returnInput()),
      ]);
      const r = (await accounts().read(rid)).receivable;
      expect(r.paidAmount.minorUnits).toBe("1000");
      expect(r.returnedAmount.minorUnits).toBe("2000");
      expect(r.outstandingAmount.minorUnits).toBe("3000");
    });
    it("IMMEDIATE constraints verify linked collection and rollback later failure", async () => {
      const { rid } = await sold();
      await expect(
        sql(tenantA, async (c) => {
          await c.query(
            "SELECT retail.collect_receivable($1,$2,'card',1000,NULL,$1)",
            [randomUUID(), rid],
          );
          await c.query("SET CONSTRAINTS ALL IMMEDIATE");
          throw new Error("After ledger failure");
        }),
      ).rejects.toThrow("After ledger failure");
      expect(await debt(rid)).toBe("6000");
      await sql(tenantA, async (c) => {
        await c.query(
          "SELECT retail.collect_receivable($1,$2,'cash',1000,$3,$1)",
          [randomUUID(), rid, shiftId],
        );
        await c.query("SET CONSTRAINTS ALL IMMEDIATE");
      });
      expect(await debt(rid)).toBe("5000");
    });
    it("reports separate pending/generated/collected and never double-count sale revenue", async () => {
      const { rid } = await sold(4000n);
      await accounts().collect(rid, card("1000"), randomUUID());
      const report = await new PostgresReporting(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      }).operationalReport(reportPeriod("today"));
      expect(report.sales.gross).toBe("6000");
      expect(report.sales.cash).toBe("2000");
      expect(report.credit).toEqual({
        outstanding: "3000",
        generated: "4000",
        collected: "1000",
        openAccounts: "1",
      });
    });
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
    it("records a tenant-scoped immutable audit entry", async () => {
      const original = await sold("card");
      const result = await repo().returnSale(
        original.sale.id,
        command(1000n, "card"),
      );
      const audit = (
        await admin.query<{
          id: string;
          tenant_id: string;
          actor_user_id: string;
          action: string;
          entity_type: string;
          entity_id: string;
          metadata: {
            sale_id: string;
            total_minor_units: string;
            refund_methods: string[];
          };
        }>(
          "SELECT id,tenant_id,actor_user_id,action,entity_type,entity_id,metadata FROM retail.audit_log WHERE entity_id=$1",
          [result.record.id],
        )
      ).rows[0];
      if (!audit) throw new Error("Missing return audit entry");
      expect(audit).toMatchObject({
        tenant_id: tenantA,
        actor_user_id: ownerUser,
        action: "sales.return",
        entity_type: "sale_return",
        entity_id: result.record.id,
        metadata: {
          sale_id: original.sale.id,
          total_minor_units: "2000",
          refund_methods: ["card"],
        },
      });
      await expect(
        admin.query(
          "UPDATE retail.audit_log SET action='tampered' WHERE id=$1",
          [audit.id],
        ),
      ).rejects.toThrow();
    });
    it("audit omission or incorrect metadata rolls back all return effects", async () => {
      const original = await sold();
      const migration = await readFile(
        new URL(
          "../migrations/011_harden_sale_return_audit.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const restoreFunction = migration.slice(
        migration.indexOf(
          "CREATE OR REPLACE FUNCTION retail.record_sale_return_audit",
        ),
        migration.indexOf("CREATE POLICY audit_read"),
      );
      try {
        for (const body of [
          "BEGIN RETURN; END;",
          "BEGIN INSERT INTO retail.audit_log(id,tenant_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES(p_audit_id,current_setting('app.tenant_id')::uuid,current_setting('app.user_id')::uuid,'sales.return','sale_return',p_return_id,'{}'); END;",
        ]) {
          await admin.query(
            `CREATE OR REPLACE FUNCTION retail.record_sale_return_audit(p_audit_id uuid,p_original_sale_id uuid,p_return_id uuid,p_request_correlation_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,retail AS $$ ${body} $$`,
          );
          await expect(
            repo().returnSale(original.sale.id, command()),
          ).rejects.toMatchObject({
            code: "23514",
            message: "Return audit incomplete",
          });
          expect(await count()).toEqual({
            returns: "0",
            receipts: "0",
            cash: "0",
          });
          expect(await stock()).toBe(5000n);
          expect(await expected()).toBe(6000n);
          expect(
            (await admin.query("SELECT count(*) AS n FROM retail.audit_log"))
              .rows[0]?.n,
          ).toBe("0");
        }
      } finally {
        await admin.query(restoreFunction);
      }
    });
    it("retry preserves one audit and later audit cannot be fabricated", async () => {
      const original = await sold("card"),
        c = command(1000n, "card");
      const result = await repo().returnSale(original.sale.id, c);
      await repo().returnSale(original.sale.id, c);
      expect(
        (await admin.query("SELECT count(*) AS n FROM retail.audit_log"))
          .rows[0]?.n,
      ).toBe("1");
      await expect(
        sql(tenantA, (client) =>
          client.query(
            "SELECT retail.record_sale_return_audit($1,$2,$3,NULL)",
            [randomUUID(), original.sale.id, result.record.id],
          ),
        ),
      ).rejects.toMatchObject({
        code: "23514",
        message: "Invalid return audit context",
      });
    });
    it("zero-cent fractional return records empty audit refund methods", async () => {
      const p = createProduct({
        ...fixtureProduct(productId(randomUUID()), "FRACTION", null),
        unit: "kg",
        salePrice: money(500n),
      });
      await db.createProduct(p);
      await receiveInventory(db, {
        id: inventoryMovementId(randomUUID()),
        type: "receipt",
        productId: p.id,
        locationId: source,
        quantity: quantity("kg", 3n),
      });
      const original = (
        await completeSaleTransaction(repo(), {
          shiftId,
          locationId: source,
          draft: addSaleProduct(
            createSaleDraft(randomUUID()),
            p,
            quantity("kg", 3n),
          ),
          payments: [{ method: "card", amount: money(2n) }],
          movements: [{ productId: p.id, movementId: randomUUID() }],
        })
      ).recorded;
      const input = (refunds: SaleReturnInput["refunds"]): SaleReturnInput => ({
        id: randomUUID(),
        lines: [
          {
            saleLineId: p.id,
            productId: p.id,
            quantity: quantity("kg", 1n),
            movementId: randomUUID(),
          },
        ],
        refunds,
      });
      await repo().returnSale(
        original.sale.id,
        input([{ method: "card", amount: money(1n) }]),
      );
      const zero = await repo().returnSale(original.sale.id, input([]));
      expect(zero.record.total.minorUnits).toBe(0n);
      expect(
        (
          await admin.query(
            "SELECT metadata->'refund_methods' AS methods FROM retail.audit_log WHERE entity_id=$1",
            [zero.record.id],
          )
        ).rows[0]?.methods,
      ).toEqual([]);
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
        constraint: "sale_paid_line",
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
    it("filters stock and denies missing or foreign location", async () => {
      expect(await db.listStock(source)).toHaveLength(1);
      await expect(db.listStock(randomUUID())).rejects.toThrow(
        "Permission denied",
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
      await expect(db.listStock(id)).rejects.toThrow("Permission denied");
      await expect(
        receiveInventory(db, { ...receipt(), locationId: id }),
      ).rejects.toThrow("Permission denied");
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
    expect(tables.rows).toHaveLength(57);
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
        ),
      ).rejects.toMatchObject({ code: "42501" });
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
          "INSERT INTO retail.tenant_memberships VALUES ($1,$2,'unsupported_role','active')",
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

  describe("TASK020 purchasing transactions", () => {
    const purchaseRepo = (
      userId = ownerUser,
      tenantId = tenantA,
      runtime = false,
    ) => new PostgresPurchasing(runtime ? apiPool : pool, { userId, tenantId });
    async function purchase(ordered = true, extra = false) {
      const repo = purchaseRepo();
      const supplier = await repo.createSupplier(randomUUID(), {
        name: "Supply",
        status: "active",
      });
      const lines = [
        {
          productId: product,
          quantityOrdered: quantity("piece", 10000n),
          unitCost: money(777n),
        },
      ];
      if (extra) {
        const id = productId("550e8400-e29b-41d4-a716-446655440099");
        await db.createProduct(fixtureProduct(id, "SECOND", null));
        lines.push({
          productId: id,
          quantityOrdered: quantity("piece", 10000n),
          unitCost: money(999n),
        });
      }
      const input: PurchaseDraftInput = {
        id: randomUUID(),
        supplierId: supplier.id,
        locationId: source,
        lines,
      };
      const draft = await repo.createPurchase(input);
      return {
        repo,
        input,
        supplier,
        order: ordered ? await repo.changePurchase(draft.id, "order") : draft,
      };
    }
    const incoming = (amount = 4000n, id = randomUUID()) => ({
      id,
      lines: [{ productId: product, quantity: quantity("piece", amount) }],
    });
    it("supplier create/edit/deactivate preserves used supplier and forbids hard delete", async () => {
      const p = await purchase();
      const updated = await p.repo.updateSupplier(p.supplier.id, {
        name: "Updated",
        status: "inactive",
      });
      expect(updated.status).toBe("inactive");
      expect((await p.repo.listSuppliers())[0]?.name).toBe("Updated");
      await expect(
        sql(tenantA, (c) =>
          c.query("DELETE FROM retail.suppliers WHERE id=$1", [p.supplier.id]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      expect((await p.repo.readPurchase(p.order.id)).supplierId).toBe(
        p.supplier.id,
      );
    });
    it("clerk can read suppliers/orders and cannot create/edit them", async () => {
      const p = await purchase();
      const clerk = purchaseRepo(clerkUser);
      expect((await clerk.listSuppliers()).length).toBe(1);
      expect((await clerk.listPurchases()).length).toBe(1);
      await expect(
        clerk.createSupplier(randomUUID(), {
          name: "Denied",
          status: "active",
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(clerk.updatePurchase(p.input)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(
        clerk.changePurchase(p.order.id, "cancel"),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("admin has all purchasing permissions", async () => {
      for (const permission of [
        "suppliers.read",
        "suppliers.write",
        "purchases.read",
        "purchases.write",
        "purchases.receive",
      ] as const)
        await purchaseRepo(adminUser).authorize(permission);
    });
    it("draft replacement preserves zero received and independent cost snapshot", async () => {
      const p = await purchase(false);
      const updated = await p.repo.updatePurchase({
        ...p.input,
        notes: "Draft changed",
        lines: [
          {
            ...p.input.lines[0]!,
            unitCost: money(888n),
            quantityOrdered: quantity("piece", 12000n),
          },
        ],
      });
      expect(updated.lines[0]?.quantityReceived.milliUnits).toBe(0n);
      expect(updated.lines[0]?.unitCost.minorUnits).toBe(888n);
      expect((await db.listProducts())[0]?.purchaseCost.minorUnits).toBe(1250n);
    });
    it("inactive supplier cannot create draft or be ordered", async () => {
      const p = await purchase(false);
      await p.repo.updateSupplier(p.supplier.id, { status: "inactive" });
      await expect(
        p.repo.createPurchase({ ...p.input, id: randomUUID() }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        p.repo.changePurchase(p.order.id, "order"),
      ).rejects.toThrow();
    });
    it("foreign supplier and foreign order cannot cross tenant boundaries", async () => {
      const p = await purchase();
      const other = purchaseRepo(ownerUser, tenantB);
      const foreign = await other.createSupplier(randomUUID(), {
        name: "Foreign",
        status: "active",
      });
      await expect(
        p.repo.createPurchase({
          ...p.input,
          id: randomUUID(),
          supplierId: foreign.id,
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(other.readPurchase(p.order.id)).rejects.toThrow();
      expect((await other.listPurchases()).length).toBe(0);
      const command = incoming();
      await p.repo.receivePurchaseOrder(p.order.id, command);
      await expect(
        other.receivePurchaseOrder(p.order.id, command),
      ).rejects.toThrow();
      const foreignOrder = await other.createPurchase({
        ...p.input,
        id: randomUUID(),
        supplierId: foreign.id,
      });
      await other.changePurchase(foreignOrder.id, "order");
      await expect(
        other.receivePurchaseOrder(foreignOrder.id, command),
      ).rejects.toBeInstanceOf(PurchaseConflictError);
      expect(
        (
          await sql(tenantB, (c) =>
            c.query(
              "SELECT id FROM retail.purchase_receipts WHERE tenant_id=$1",
              [tenantA],
            ),
          )
        ).rows,
      ).toHaveLength(0);
      expect(await stock()).toBe(14000n);
    });
    it("foreign product and location are rejected", async () => {
      const p = await purchase(false);
      const foreignProduct = productId(randomUUID()),
        foreignLocation = inventoryLocationId(randomUUID());
      await other.createProduct(
        fixtureProduct(foreignProduct, "FOREIGN", null),
      );
      await other.createLocation(
        createInventoryLocation({
          id: foreignLocation,
          name: inventoryLocationName("Other"),
          code: inventoryLocationCode("OTHER"),
          status: "active",
        }),
      );
      await expect(
        p.repo.createPurchase({
          ...p.input,
          id: randomUUID(),
          locationId: foreignLocation,
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        p.repo.createPurchase({
          ...p.input,
          id: randomUUID(),
          lines: [{ ...p.input.lines[0]!, productId: foreignProduct }],
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("ordered lines cannot be freely edited", async () => {
      const p = await purchase();
      await expect(p.repo.updatePurchase(p.input)).rejects.toBeInstanceOf(
        PurchaseConflictError,
      );
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "DELETE FROM retail.purchase_order_lines WHERE purchase_id=$1",
            [p.order.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "P0001" });
    });
    it("clerk partial then full receipt updates ledger and exact stock without product cost mutation", async () => {
      const p = await purchase();
      const clerk = purchaseRepo(clerkUser);
      expect(
        (await clerk.receivePurchaseOrder(p.order.id, incoming())).order.status,
      ).toBe("partially_received");
      expect(await stock()).toBe(14000n);
      const full = await clerk.receivePurchaseOrder(
        p.order.id,
        incoming(6000n),
      );
      expect(full.order.status).toBe("received");
      expect(full.order.lines[0]?.quantityReceived.milliUnits).toBe(10000n);
      expect(await stock()).toBe(20000n);
      expect((await db.listProducts())[0]?.purchaseCost.minorUnits).toBe(1250n);
      const count = await admin.query(
        "SELECT count(*)::int n FROM retail.inventory_movements WHERE purchase_receipt_id IS NOT NULL",
      );
      expect(count.rows[0]?.n).toBe(2);
    });
    it("over-receive and mismatched unit roll back entirely", async () => {
      const p = await purchase();
      await expect(
        p.repo.receivePurchaseOrder(p.order.id, incoming(11000n)),
      ).rejects.toBeInstanceOf(PurchaseConflictError);
      await expect(
        p.repo.receivePurchaseOrder(p.order.id, {
          id: randomUUID(),
          lines: [{ productId: product, quantity: quantity("kg", 1n) }],
        }),
      ).rejects.toBeInstanceOf(PurchaseConflictError);
      expect(await stock()).toBe(10000n);
      expect((await p.repo.readPurchase(p.order.id)).status).toBe("ordered");
    });
    it("stable receipt ID replays and different payload conflicts", async () => {
      const p = await purchase();
      const command = incoming();
      await p.repo.receivePurchaseOrder(p.order.id, command);
      expect(
        (await p.repo.receivePurchaseOrder(p.order.id, command)).replayed,
      ).toBe(true);
      await expect(
        p.repo.receivePurchaseOrder(p.order.id, incoming(1000n, command.id)),
      ).rejects.toBeInstanceOf(PurchaseConflictError);
      expect(await stock()).toBe(14000n);
    });
    it("two concurrent final receipts cannot over-receive", async () => {
      const p = await purchase();
      const result = await Promise.allSettled([
        p.repo.receivePurchaseOrder(p.order.id, incoming(10000n)),
        p.repo.receivePurchaseOrder(p.order.id, incoming(10000n)),
      ]);
      expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(result.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect(await stock()).toBe(20000n);
    });
    it("concurrent identical receipt ID commits only once", async () => {
      const p = await purchase();
      const command = incoming(10000n);
      const result = await Promise.all([
        p.repo.receivePurchaseOrder(p.order.id, command),
        p.repo.receivePurchaseOrder(p.order.id, command),
      ]);
      expect(result.map((r) => r.replayed).sort()).toEqual([false, true]);
      expect(await stock()).toBe(20000n);
    });
    it("second-line storage failure rolls back first movement, quantities, receipt and audit", async () => {
      const p = await purchase(true, true);
      const second = p.input.lines[1]!.productId;
      await receiveInventory(db, {
        id: inventoryMovementId(randomUUID()),
        type: "receipt",
        productId: second,
        locationId: source,
        quantity: quantity("piece", 9223372036854775000n),
      });
      const auditBefore = (
        await admin.query("SELECT count(*)::int n FROM retail.purchasing_audit")
      ).rows[0]?.n;
      await expect(
        p.repo.receivePurchaseOrder(p.order.id, {
          id: randomUUID(),
          lines: [
            { productId: product, quantity: quantity("piece", 1000n) },
            { productId: second, quantity: quantity("piece", 1000n) },
          ],
        }),
      ).rejects.toThrow();
      expect(await stock()).toBe(10000n);
      expect(
        (await p.repo.readPurchase(p.order.id)).lines.every(
          (l) => l.quantityReceived.milliUnits === 0n,
        ),
      ).toBe(true);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.purchase_receipts",
          )
        ).rows[0]?.n,
      ).toBe(0);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.purchasing_audit",
          )
        ).rows[0]?.n,
      ).toBe(auditBefore);
    });
    it("cancel after partial keeps receipts and refuses a new receipt", async () => {
      const p = await purchase();
      const command = incoming();
      await p.repo.receivePurchaseOrder(p.order.id, command);
      expect((await p.repo.changePurchase(p.order.id, "cancel")).status).toBe(
        "cancelled",
      );
      await expect(
        p.repo.receivePurchaseOrder(p.order.id, incoming(6000n)),
      ).rejects.toBeInstanceOf(PurchaseConflictError);
      expect(
        (await p.repo.receivePurchaseOrder(p.order.id, command)).replayed,
      ).toBe(true);
      expect(await stock()).toBe(14000n);
    });
    it("draft and received reject new receptions", async () => {
      const p = await purchase(false);
      await expect(
        p.repo.receivePurchaseOrder(p.order.id, incoming()),
      ).rejects.toBeInstanceOf(PurchaseConflictError);
      await p.repo.changePurchase(p.order.id, "order");
      await p.repo.receivePurchaseOrder(p.order.id, incoming(10000n));
      await expect(
        p.repo.receivePurchaseOrder(p.order.id, incoming(1000n)),
      ).rejects.toBeInstanceOf(PurchaseConflictError);
    });
    it("inactive membership cannot replay a durable receipt", async () => {
      const p = await purchase();
      const command = incoming();
      await p.repo.receivePurchaseOrder(p.order.id, command);
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND user_id=$2",
        [tenantA, ownerUser],
      );
      await expect(
        p.repo.receivePurchaseOrder(p.order.id, command),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        purchaseRepo(outsiderUser).listSuppliers(),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("SQL cannot forge quantityReceived or received status without ledger", async () => {
      const p = await purchase();
      await expect(
        sql(tenantA, async (c) => {
          await c.query("SELECT set_config('app.correlation_id',$1,true)", [
            randomUUID(),
          ]);
          return c.query(
            "UPDATE retail.purchase_order_lines SET quantity_received=1000 WHERE purchase_id=$1",
            [p.order.id],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        sql(tenantA, async (c) => {
          await c.query("SELECT set_config('app.correlation_id',$1,true)", [
            randomUUID(),
          ]);
          return c.query(
            "UPDATE retail.purchase_orders SET status='received' WHERE id=$1",
            [p.order.id],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("SQL draft line replacement has mandatory actor/company/correlation audit", async () => {
      const p = await purchase(false);
      const before = (
        await admin.query("SELECT count(*)::int n FROM retail.purchasing_audit")
      ).rows[0]?.n;
      await sql(tenantA, async (c) => {
        await c.query("SELECT set_config('app.correlation_id',$1,true)", [
          randomUUID(),
        ]);
        await c.query(
          "DELETE FROM retail.purchase_order_lines WHERE purchase_id=$1",
          [p.order.id],
        );
        await c.query(
          "INSERT INTO retail.purchase_order_lines(tenant_id,purchase_id,product_id,unit,quantity_ordered,unit_cost) VALUES($1,$2,$3,'piece',10000,222)",
          [tenantA, p.order.id, product],
        );
      });
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.purchasing_audit",
          )
        ).rows[0]?.n,
      ).toBe(before + 2);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.purchasing_audit WHERE correlation_id IS NULL OR actor_user_id<>$1 OR tenant_id<>$2",
            [ownerUser, tenantA],
          )
        ).rows[0]?.n,
      ).toBe(0);
    });
    it("restricted production role works without owner/BYPASSRLS and cannot alter membership/audit", async () => {
      const p = await purchase();
      const runtime = purchaseRepo(ownerUser, tenantA, true);
      expect(
        (await runtime.receivePurchaseOrder(p.order.id, incoming(10000n))).order
          .status,
      ).toBe("received");
      await expect(
        sql(tenantA, (c) => c.query("DELETE FROM retail.purchasing_audit")),
      ).rejects.toMatchObject({ code: "42501" });
      const roles = await apiPool.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      expect(roles.rows[0]).toMatchObject({
        rolsuper: false,
        rolbypassrls: false,
      });
      const tables = await admin.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='retail' AND c.relname=ANY($1::text[])",
        [
          [
            "suppliers",
            "purchase_orders",
            "purchase_order_lines",
            "purchase_receipts",
            "purchase_receipt_lines",
            "purchasing_audit",
          ],
        ],
      );
      expect(tables.rows).toHaveLength(6);
      expect(
        tables.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
      ).toBe(true);
    });
  });
  describe("customers and sale association", () => {
    const repo = (userId = ownerUser, tenantId = tenantA) =>
      new PostgresCustomers(pool, { userId, tenantId });
    const sales = () =>
      new PostgresSales(pool, { userId: ownerUser, tenantId: tenantA });
    const fields = {
      name: "SMOKE Customer",
      status: "active" as const,
      phone: "123456",
      email: "smoke@example.invalid",
      notes: "Private note",
    };
    const create = () => repo().createCustomer(randomUUID(), fields);
    const checkout = (cid?: string): SaleCheckoutInput => ({
      shiftId,
      locationId: source,
      draft: addSaleProduct(
        createSaleDraft(randomUUID(), cid),
        fixtureProduct(),
        quantity("piece", 1000n),
      ),
      payments: [{ method: "cash", amount: money(2000n) }],
      movements: [{ productId: product, movementId: randomUUID() }],
    });
    it("creates reads updates and clears optional fields", async () => {
      const c = await create();
      expect((await repo().listCustomers())[0]?.id).toBe(c.id);
      const patched = await repo().updateCustomer(c.id, {
        name: "Updated",
        phone: null,
        email: null,
        notes: null,
      });
      expect(patched.name).toBe("Updated");
      expect(patched.phone).toBeUndefined();
      expect(patched.email).toBeUndefined();
      expect(patched.notes).toBeUndefined();
      expect(patched.createdAt).toBe(c.createdAt);
    });
    it("searches name phone email literally with case insensitive bounded input", async () => {
      await create();
      for (const q of ["smoke customer", "1234", "EXAMPLE.INVALID"])
        expect(await repo().listCustomers(q)).toHaveLength(1);
      expect(await repo().listCustomers("' OR 1=1 --")).toHaveLength(0);
      expect(await repo().listCustomers("%")).toHaveLength(0);
      await expect(repo().listCustomers("x".repeat(201))).rejects.toThrow(
        TypeError,
      );
    });
    it("admin has customer read/write without changing roles", async () => {
      const c = await repo(adminUser).createCustomer(randomUUID(), fields);
      expect((await repo(adminUser).readCustomer(c.id)).customer.id).toBe(c.id);
      await expect(
        repo(adminUser).updateCustomer(c.id, { status: "inactive" }),
      ).resolves.toMatchObject({ status: "inactive" });
    });
    it("inventory clerk cannot list create read or update customers", async () => {
      const c = await create();
      const clerk = repo(clerkUser);
      for (const work of [
        () => clerk.listCustomers(),
        () => clerk.createCustomer(randomUUID(), fields),
        () => clerk.readCustomer(c.id),
        () => clerk.updateCustomer(c.id, { status: "inactive" }),
      ])
        await expect(work()).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("outsider and revoked membership cannot access directory", async () => {
      await create();
      await expect(repo(outsiderUser).listCustomers()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND user_id=$2",
        [tenantA, ownerUser],
      );
      await expect(repo().listCustomers()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
    it("customer/audit tables FORCE RLS and direct other tenant access is denied", async () => {
      const c = await create();
      const rows = await admin.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='retail' AND relname=ANY($1)",
        [["customers", "customer_audit"]],
      );
      expect(rows.rows).toHaveLength(2);
      expect(
        rows.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
      ).toBe(true);
      await sql(tenantB, async (c) =>
        expect(
          (await c.query("SELECT * FROM retail.customers")).rows,
        ).toHaveLength(0),
      );
      await expect(
        repo(ownerUser, tenantB).readCustomer(c.id),
      ).rejects.toBeInstanceOf(CustomerNotFoundError);
      await expect(
        sql(tenantB, (c) =>
          c.query(
            "INSERT INTO retail.customers(id,tenant_id,name,status) VALUES($1,$2,'Hidden','active')",
            [randomUUID(), tenantA],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("sale without customer retains normal totals cash and stock", async () => {
      const result = await completeSaleTransaction(
        new PostgresSales(apiPool, { userId: ownerUser, tenantId: tenantA }),
        checkout(),
      );
      expect(result.recorded.sale.customerId).toBeUndefined();
      expect(result.recorded.customerName).toBeUndefined();
      expect(result.recorded.sale.total.minorUnits).toBe(2000n);
      expect(await stock()).toBe(9000n);
    });
    it("same tenant active customer is associated and history contains exact totals payments", async () => {
      const c = await create(),
        command = checkout(c.id);
      const result = await completeSaleTransaction(
        new PostgresSales(apiPool, { userId: ownerUser, tenantId: tenantA }),
        command,
      );
      expect(result.recorded.sale.customerId).toBe(c.id);
      expect(result.recorded.customerName).toBe(fields.name);
      const detail = await repo().readCustomer(c.id);
      expect(detail.sales).toHaveLength(1);
      expect(detail.sales[0]).toMatchObject({
        id: command.draft.id,
        total: money(2000n),
        paymentMethods: ["cash"],
        returnedTotal: money(0n),
      });
      expect((await repo().listCustomers())[0]?.lastPurchaseAt).toBe(
        result.recorded.createdAt,
      );
    });
    it("foreign and missing customers reject atomically without stock changes", async () => {
      const foreign = await repo(ownerUser, tenantB).createCustomer(
        randomUUID(),
        fields,
      );
      for (const cid of [foreign.id, randomUUID()])
        await expect(
          completeSaleTransaction(sales(), checkout(cid)),
        ).rejects.toBeInstanceOf(CustomerUnavailableError);
      expect(await stock()).toBe(10000n);
      expect(
        (await admin.query("SELECT count(*) FROM retail.sales")).rows[0]?.count,
      ).toBe("0");
    });
    it("inactive customer cannot be used for new sale", async () => {
      const c = await create();
      await repo().updateCustomer(c.id, { status: "inactive" });
      await expect(
        completeSaleTransaction(sales(), checkout(c.id)),
      ).rejects.toBeInstanceOf(CustomerUnavailableError);
      expect(await stock()).toBe(10000n);
    });
    it("deactivation and rename preserve historical reference and ticket snapshot", async () => {
      const c = await create(),
        result = await completeSaleTransaction(sales(), checkout(c.id));
      await repo().updateCustomer(c.id, {
        status: "inactive",
        name: "Renamed",
      });
      const record = await sales().readSale(result.recorded.sale.id);
      expect(record.sale.customerId).toBe(c.id);
      expect(record.customerName).toBe(fields.name);
      expect((await repo().readCustomer(c.id)).sales).toHaveLength(1);
    });
    it("same SaleId replays original customer even after deactivation", async () => {
      const c = await create(),
        command = checkout(c.id);
      await completeSaleTransaction(sales(), command);
      await repo().updateCustomer(c.id, { status: "inactive" });
      const replay = await completeSaleTransaction(sales(), command);
      expect(replay.replayed).toBe(true);
      expect(replay.recorded.sale.customerId).toBe(c.id);
      expect(await stock()).toBe(9000n);
    });
    it("different or removed customer on identical SaleId conflicts", async () => {
      const a = await create(),
        b = await create(),
        command = checkout(a.id);
      await completeSaleTransaction(sales(), command);
      for (const customerId of [b.id, undefined]) {
        const draft = { ...command.draft };
        if (customerId === undefined) delete draft.customerId;
        else draft.customerId = customerId;
        await expect(
          completeSaleTransaction(sales(), { ...command, draft }),
        ).rejects.toBeInstanceOf(SaleIdempotencyConflictError);
      }
      expect(await stock()).toBe(9000n);
    });
    it("concurrent identical commands commit exactly one sale", async () => {
      const c = await create(),
        command = checkout(c.id);
      const results = await Promise.all([
        completeSaleTransaction(sales(), command),
        completeSaleTransaction(sales(), command),
      ]);
      expect(results.filter((r) => r.replayed)).toHaveLength(1);
      expect(await stock()).toBe(9000n);
      expect((await repo().readCustomer(c.id)).sales).toHaveLength(1);
    });
    it("customer SHARE lock serializes concurrent deactivation", async () => {
      const c = await create();
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((r) => (release = r)),
        locked = new Promise<void>((r) => (entered = r)),
        base = sales();
      const work = completeSaleTransaction(
        {
          readSale: (id) => base.readSale(id),
          runSale: (id, fn) =>
            base.runSale(id, (tx) =>
              fn({
                ...tx,
                validateCustomer: async (cid) => {
                  await tx.validateCustomer?.(cid);
                  entered();
                  await gate;
                },
              }),
            ),
        },
        checkout(c.id),
      );
      await locked;
      try {
        await expect(
          sql(tenantA, async (client) => {
            await client.query("SET LOCAL lock_timeout='100ms'");
            await client.query(
              "SELECT set_config('app.correlation_id',$1,true)",
              [randomUUID()],
            );
            await client.query(
              "UPDATE retail.customers SET status='inactive' WHERE id=$1",
              [c.id],
            );
          }),
        ).rejects.toMatchObject({ code: "55P03" });
      } finally {
        release();
      }
      await work;
      await repo().updateCustomer(c.id, { status: "inactive" });
      expect((await repo().readCustomer(c.id)).sales).toHaveLength(1);
    });
    it("SQL trigger rejects foreign customer regardless of browser context", async () => {
      const c = await repo(ownerUser, tenantB).createCustomer(
        randomUUID(),
        fields,
      );
      await expect(
        sql(tenantA, (client) =>
          client.query(
            "INSERT INTO retail.sales(id,tenant_id,location_id,status,currency,total_minor_units,created_by,command_payload,shift_id,customer_id) VALUES($1,$2,$3,'completed','MXN',2000,$4,'{}',$5,$6)",
            [randomUUID(), tenantA, source, ownerUser, shiftId, c.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "P0001" });
      expect(await stock()).toBe(10000n);
    });
    it("history reports returns without changing sale or customer", async () => {
      const c = await create(),
        sold = await completeSaleTransaction(sales(), checkout(c.id));
      await new PostgresSaleReturns(pool, {
        userId: ownerUser,
        tenantId: tenantA,
      }).returnSale(sold.recorded.sale.id, {
        id: randomUUID(),
        lines: [
          {
            productId: product,
            saleLineId: product,
            movementId: randomUUID(),
            quantity: quantity("piece", 1000n),
          },
        ],
        refunds: [{ method: "cash", amount: money(2000n) }],
        shiftId,
        cashMovementId: randomUUID(),
      });
      const detail = await repo().readCustomer(c.id);
      expect(detail.sales[0]?.returnedTotal.minorUnits).toBe(2000n);
      expect(detail.sales[0]?.total.minorUnits).toBe(2000n);
      expect(detail.customer.id).toBe(c.id);
    });
    it("runtime customer audit records identifiers only and denies delete/audit writes", async () => {
      const runtime = new PostgresCustomers(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      });
      const c = await runtime.createCustomer(randomUUID(), fields);
      await completeSaleTransaction(sales(), checkout(c.id));
      await runtime.updateCustomer(c.id, { status: "inactive" });
      const rows = await admin.query(
        "SELECT * FROM retail.customer_audit WHERE customer_id=$1 ORDER BY created_at",
        [c.id],
      );
      expect(rows.rows).toHaveLength(2);
      expect(
        rows.rows.every(
          (r) =>
            r.actor_user_id === ownerUser &&
            r.correlation_id &&
            r.tenant_id === tenantA,
        ),
      ).toBe(true);
      expect(JSON.stringify(rows.rows)).not.toContain(fields.email);
      expect(JSON.stringify(rows.rows)).not.toContain(fields.phone);
      await expect(
        sql(tenantA, (c) => c.query("DELETE FROM retail.customers")),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "INSERT INTO retail.customer_audit(tenant_id,actor_user_id,action,customer_id,correlation_id) VALUES($1,$2,'customers.update',$3,$4)",
            [tenantA, ownerUser, randomUUID(), randomUUID()],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
  describe("TASK023 inventory minimums and replenishment", () => {
    const minimum = (
      userId = ownerUser,
      tenantId = tenantA,
      correlation = randomUUID(),
    ) =>
      new PostgresInventoryMinimum(apiPool, { userId, tenantId }, correlation);
    const reporting = (userId = ownerUser, tenantId = tenantA) =>
      new PostgresReporting(apiPool, { userId, tenantId });
    const configured = () =>
      admin.query(
        "SELECT tenant_id,product_id,location_id,unit,milli_units::text FROM retail.inventory_minimums ORDER BY tenant_id,product_id,location_id",
      );
    const audits = () =>
      admin.query(
        "SELECT * FROM retail.inventory_minimum_audit ORDER BY created_at,id",
      );
    async function inventorySnapshot() {
      return {
        balances: (
          await admin.query(
            "SELECT * FROM retail.stock_balances ORDER BY tenant_id,product_id,location_id",
          )
        ).rows,
        movements: (
          await admin.query(
            "SELECT * FROM retail.inventory_movements ORDER BY tenant_id,id",
          )
        ).rows,
        commands: (
          await admin.query(
            "SELECT * FROM retail.inventory_commands ORDER BY tenant_id,id",
          )
        ).rows,
      };
    }
    async function directInsert(
      tenant: string,
      item: string,
      location: string,
      unit = "piece",
      amount = "1000",
      user = ownerUser,
    ) {
      return sql(
        tenantA,
        async (c) => {
          await c.query("SELECT set_config('app.correlation_id',$1,true)", [
            randomUUID(),
          ]);
          return c.query(
            "INSERT INTO retail.inventory_minimums(tenant_id,product_id,location_id,unit,milli_units) VALUES($1,$2,$3,$4,$5)",
            [tenant, item, location, unit, amount],
          );
        },
        user,
      );
    }
    async function fractionalProduct() {
      const item = createProduct({
        ...fixtureProduct(productId(randomUUID()), "WEIGHT", null),
        unit: "kg",
      });
      await db.createProduct(item);
      return item.id;
    }

    it("set update and remove audit exact before/after without changing stock or ledger", async () => {
      const before = await inventorySnapshot();
      const correlation = randomUUID();
      const repo = minimum(ownerUser, tenantA, correlation);
      await repo.setMinimum(product, source, quantity("piece", 12000n));
      expect((await configured()).rows).toEqual([
        {
          tenant_id: tenantA,
          product_id: product,
          location_id: source,
          unit: "piece",
          milli_units: "12000",
        },
      ]);
      await repo.setMinimum(product, source, quantity("piece", 15000n));
      expect((await configured()).rows[0]?.milli_units).toBe("15000");
      await repo.setMinimum(product, source, null);
      expect((await configured()).rows).toEqual([]);
      const rows = (await audits()).rows;
      expect(
        rows.map((r) => [r.action, r.before_milli_units, r.after_milli_units]),
      ).toEqual([
        ["minimum.set", null, "12000"],
        ["minimum.set", "12000", "15000"],
        ["minimum.remove", "15000", null],
      ]);
      for (const row of rows) {
        expect(row).toMatchObject({
          tenant_id: tenantA,
          product_id: product,
          location_id: source,
          unit: "piece",
          actor_user_id: ownerUser,
          correlation_id: correlation,
        });
        expect(row.created_at).toBeInstanceOf(Date);
        expect(row.id).toEqual(expect.any(String));
      }
      expect(await inventorySnapshot()).toEqual(before);
    });

    it("owner and admin write while clerk reads alerts and grid but cannot write", async () => {
      await minimum(adminUser).setMinimum(
        product,
        source,
        quantity("piece", 12000n),
      );
      expect((await audits()).rows[0]?.actor_user_id).toBe(adminUser);
      expect((await reporting(clerkUser).inventoryAlerts()).low).toBe("1");
      const clerk = new PostgresInventory(apiPool, {
        tenantId: tenantA,
        userId: clerkUser,
      });
      expect((await clerk.listStock(source))[0]).toMatchObject({
        minimumStock: quantity("piece", 12000n),
        inventoryState: "low",
      });
      const before = (await audits()).rows;
      for (const value of [quantity("piece", 20000n), null])
        await expect(
          minimum(clerkUser).setMinimum(product, source, value),
        ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        directInsert(tenantA, product, destination, "piece", "1000", clerkUser),
      ).rejects.toMatchObject({ code: "42501" });
      expect((await audits()).rows).toEqual(before);
    });

    it("outsider and revoked membership cannot read or configure minimums", async () => {
      await minimum().setMinimum(product, source, quantity("piece", 12000n));
      for (const user of [outsiderUser, ownerUser]) {
        if (user === ownerUser)
          await admin.query(
            "UPDATE retail.tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND user_id=$2",
            [tenantA, ownerUser],
          );
        await expect(
          minimum(user).setMinimum(product, source, null),
        ).rejects.toBeInstanceOf(PermissionDeniedError);
        await expect(reporting(user).inventoryAlerts()).rejects.toBeInstanceOf(
          PermissionDeniedError,
        );
        expect(
          (
            await sql(
              tenantA,
              (c) => c.query("SELECT * FROM retail.inventory_minimums"),
              user,
            )
          ).rows,
        ).toEqual([]);
      }
      expect((await configured()).rows).toHaveLength(1);
      expect((await audits()).rows).toHaveLength(1);
    });

    it("RLS scopes configuration audit and alerts even with shared product and location IDs", async () => {
      await minimum().setMinimum(product, source, quantity("piece", 12000n));
      await minimum(ownerUser, tenantB).setMinimum(
        product,
        source,
        quantity("piece", 3000n),
      );
      const rows = await sql(tenantA, (c) =>
        c.query(
          "SELECT tenant_id,milli_units::text FROM retail.inventory_minimums",
        ),
      );
      expect(rows.rows).toEqual([{ tenant_id: tenantA, milli_units: "12000" }]);
      expect(
        (
          await sql(tenantA, (c) =>
            c.query("SELECT tenant_id FROM retail.inventory_minimum_audit"),
          )
        ).rows,
      ).toEqual([{ tenant_id: tenantA }]);
      expect(
        (await reporting(ownerUser, tenantB).inventoryAlerts()).alerts[0],
      ).toMatchObject({ stock: "0", minimum: "3000", state: "out" });
      await expect(
        directInsert(tenantB, product, destination),
      ).rejects.toMatchObject({ code: "42501" });
      expect(
        (
          await sql(undefined, (c) =>
            c.query("SELECT * FROM retail.inventory_minimums"),
          )
        ).rows,
      ).toEqual([]);
    });

    it("missing and foreign product or location fail closed at repository and composite FK", async () => {
      const foreign = productId(randomUUID()),
        location = inventoryLocationId(randomUUID());
      await other.createProduct(fixtureProduct(foreign, "FOREIGN-MIN", null));
      await other.createLocation(
        createInventoryLocation({
          id: location,
          code: inventoryLocationCode("FOREIGN-MIN"),
          name: inventoryLocationName("Foreign"),
          status: "active",
        }),
      );
      for (const [item, place] of [
        [foreign, source],
        [product, location],
        [randomUUID(), source],
        [product, randomUUID()],
      ]) {
        await expect(
          minimum().setMinimum(item!, place!, quantity("piece", 1000n)),
        ).rejects.toBeInstanceOf(PermissionDeniedError);
        await expect(
          directInsert(tenantA, item!, place!),
        ).rejects.toMatchObject({ code: "23503" });
        await expect(
          reporting().inventoryAlerts(place!, item!),
        ).rejects.toBeInstanceOf(PermissionDeniedError);
        await expect(
          reporting().replenishment(item!, place!),
        ).rejects.toBeInstanceOf(PermissionDeniedError);
      }
      expect((await configured()).rows).toEqual([]);
      expect((await audits()).rows).toEqual([]);
    });

    it("product unit mismatch fails in repository and SQL FK without partial audit", async () => {
      await expect(
        minimum().setMinimum(product, source, quantity("kg", 1000n)),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        directInsert(tenantA, product, source, "kg"),
      ).rejects.toMatchObject({ code: "23503" });
      expect((await configured()).rows).toEqual([]);
      expect((await audits()).rows).toEqual([]);
    });

    it("negative and fractional piece minimums fail application and SQL constraints", async () => {
      for (const amount of [-1000n, 1001n]) {
        await expect(
          minimum().setMinimum(product, source, {
            unit: "piece",
            milliUnits: amount,
          } as Quantity),
        ).rejects.toBeInstanceOf(RangeError);
        await expect(
          directInsert(tenantA, product, source, "piece", amount.toString()),
        ).rejects.toMatchObject({ code: "23514" });
      }
      expect((await configured()).rows).toEqual([]);
      expect((await audits()).rows).toEqual([]);
    });

    it("fractional quantities preserve exact BIGINT maximum and overflow leaves prior value intact", async () => {
      const item = await fractionalProduct();
      await minimum().setMinimum(
        item,
        source,
        quantity("kg", 9223372036854775807n),
      );
      const before = (await audits()).rows;
      expect((await configured()).rows[0]?.milli_units).toBe(
        "9223372036854775807",
      );
      expect(
        (await reporting().inventoryAlerts(source, item)).alerts[0],
      ).toMatchObject({
        unit: "kg",
        stock: "0",
        minimum: "9223372036854775807",
        suggested: "9223372036854775807",
      });
      expect(
        (await reporting().replenishment(item, source)).quantityOrdered,
      ).toEqual({ unit: "kg", milliUnits: "9223372036854775807" });
      await expect(
        minimum().setMinimum(item, source, {
          unit: "kg",
          milliUnits: 9223372036854775808n,
        } as Quantity),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        directInsert(tenantA, item, destination, "kg", "9223372036854775808"),
      ).rejects.toMatchObject({ code: "22003" });
      expect((await configured()).rows[0]?.milli_units).toBe(
        "9223372036854775807",
      );
      expect((await audits()).rows).toEqual(before);
    });

    it("location specific low normal and out states agree across grid alerts and dashboard", async () => {
      await minimum().setMinimum(product, source, quantity("piece", 12000n));
      await minimum().setMinimum(
        product,
        destination,
        quantity("piece", 3000n),
      );
      const alerts = await reporting().inventoryAlerts();
      expect(alerts).toMatchObject({ low: "1", empty: "1" });
      expect(alerts.alerts).toHaveLength(2);
      expect(alerts.alerts.find((a) => a.locationId === source)).toEqual({
        id: product,
        name: "Producto",
        sku: "SKU-1",
        locationId: source,
        locationName: "Almacén",
        unit: "piece",
        stock: "10000",
        minimum: "12000",
        suggested: "2000",
        state: "low",
      });
      expect(
        alerts.alerts.find((a) => a.locationId === destination),
      ).toMatchObject({
        stock: "0",
        minimum: "3000",
        suggested: "3000",
        state: "out",
      });
      expect(
        (await reporting().operationalReport(reportPeriod("30d"))).inventory,
      ).toEqual(alerts);
      expect((await db.listStock(source))[0]).toMatchObject({
        inventoryState: "low",
        suggestedQuantity: quantity("piece", 2000n),
      });
      await minimum().setMinimum(product, source, quantity("piece", 9000n));
      expect((await db.listStock(source))[0]?.inventoryState).toBe("normal");
      expect(await reporting().inventoryAlerts(source, product)).toEqual({
        low: "0",
        empty: "0",
        alerts: [],
      });
    });

    it("equality is low but zero shortfall cannot prefill or create a purchase", async () => {
      await minimum().setMinimum(product, source, quantity("piece", 10000n));
      expect(
        (await reporting().inventoryAlerts(source, product)).alerts[0],
      ).toMatchObject({ state: "low", suggested: "0" });
      await expect(
        reporting().replenishment(product, source),
      ).rejects.toBeInstanceOf(RangeError);
      await minimum().setMinimum(product, destination, quantity("piece", 0n));
      expect(
        (await reporting().inventoryAlerts(destination, product)).alerts[0],
      ).toMatchObject({ state: "out", minimum: "0", suggested: "0" });
      await expect(
        reporting().replenishment(product, destination),
      ).rejects.toBeInstanceOf(RangeError);
      expect(
        (
          await admin.query(
            "SELECT count(*)::text n FROM retail.purchase_orders",
          )
        ).rows[0]?.n,
      ).toBe("0");
    });

    it("unconfigured zero stock remains out in grid but contributes no automatic alerts", async () => {
      expect((await db.listStock(destination))[0]).toMatchObject({
        inventoryState: "out",
        balance: { quantity: quantity("piece", 0n) },
      });
      expect((await db.listStock(source))[0]?.inventoryState).toBe(
        "unconfigured",
      );
      expect(await reporting().inventoryAlerts()).toEqual({
        low: "0",
        empty: "0",
        alerts: [],
      });
      await expect(
        reporting().replenishment(product, destination),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await minimum().setMinimum(
        product,
        destination,
        quantity("piece", 3000n),
      );
      await minimum().setMinimum(product, destination, null);
      expect(
        (await reporting().operationalReport(reportPeriod("30d"))).inventory,
      ).toEqual({ low: "0", empty: "0", alerts: [] });
    });

    it("inactive configured products or locations are excluded from shared alert projection", async () => {
      await minimum().setMinimum(product, source, quantity("piece", 12000n));
      await minimum().setMinimum(
        product,
        destination,
        quantity("piece", 3000n),
      );
      // Location status has no runtime write grant; prepare only this disposable fixture.
      await admin.query(
        "UPDATE retail.inventory_locations SET status='inactive' WHERE tenant_id=$1 AND id=$2",
        [tenantA, destination],
      );
      expect((await reporting().inventoryAlerts()).alerts).toHaveLength(1);
      await sql(tenantA, (c) =>
        c.query(
          "UPDATE retail.products SET status='inactive' WHERE tenant_id=$1 AND id=$2",
          [tenantA, product],
        ),
      );
      expect(await reporting().inventoryAlerts()).toEqual({
        low: "0",
        empty: "0",
        alerts: [],
      });
      expect(
        (await reporting().operationalReport(reportPeriod("30d"))).inventory
          .alerts,
      ).toEqual([]);
    });

    it("prefill returns exact live suggestion with no supplier or automatic PO and requires both permissions", async () => {
      await minimum().setMinimum(product, source, quantity("piece", 15000n));
      const before = await inventorySnapshot();
      const auditBefore = (await audits()).rows;
      expect(await reporting().replenishment(product, source)).toEqual({
        tenantId: tenantA,
        productId: product,
        locationId: source,
        quantityOrdered: { unit: "piece", milliUnits: "5000" },
      });
      expect(await inventorySnapshot()).toEqual(before);
      await issueInventory(db, issue(1000n));
      expect(
        (await reporting(adminUser).replenishment(product, source))
          .quantityOrdered.milliUnits,
      ).toBe("6000");
      await expect(
        reporting(clerkUser).replenishment(product, source),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      for (const permission of ["inventory.read", "purchases.write"]) {
        await admin.query(
          "DELETE FROM retail.role_permissions WHERE role='owner' AND permission=$1",
          [permission],
        );
        try {
          await expect(
            reporting().replenishment(product, source),
          ).rejects.toBeInstanceOf(PermissionDeniedError);
        } finally {
          await admin.query(
            "INSERT INTO retail.role_permissions VALUES('owner',$1)",
            [permission],
          );
        }
      }
      expect(
        (
          await admin.query(
            "SELECT count(*)::text n FROM retail.purchase_orders",
          )
        ).rows[0]?.n,
      ).toBe("0");
      expect((await audits()).rows).toEqual(auditBefore);
      const after = await inventorySnapshot();
      expect(after.movements).toHaveLength(before.movements.length + 1);
    });

    it("concurrent upserts and removals preserve unique pair and serial audit history", async () => {
      const correlations = [randomUUID(), randomUUID()];
      const repos = correlations.map(
        (c) =>
          new PostgresInventoryMinimum(
            pool,
            { tenantId: tenantA, userId: ownerUser },
            c,
          ),
      );
      await Promise.all(
        repos.map((r, i) =>
          r.setMinimum(
            product,
            source,
            quantity("piece", i === 0 ? 12000n : 15000n),
          ),
        ),
      );
      const rows = (await audits()).rows;
      expect((await configured()).rows).toHaveLength(1);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.before_milli_units).toBeNull();
      expect(rows[1]?.before_milli_units).toBe(rows[0]?.after_milli_units);
      expect((await configured()).rows[0]?.milli_units).toBe(
        rows[1]?.after_milli_units,
      );
      expect(rows.map((r) => r.correlation_id).sort()).toEqual(
        [...correlations].sort(),
      );
      await Promise.all(repos.map((r) => r.setMinimum(product, source, null)));
      expect((await configured()).rows).toEqual([]);
      const final = (await audits()).rows;
      expect(final).toHaveLength(3);
      expect(final[2]).toMatchObject({
        action: "minimum.remove",
        before_milli_units: rows[1]?.after_milli_units,
        after_milli_units: null,
      });
      await Promise.all([
        repos[0]!.setMinimum(product, source, quantity("piece", 18000n)),
        repos[1]!.setMinimum(product, source, null),
      ]);
      const raced = (await audits()).rows;
      const remaining = (await configured()).rows;
      expect(raced.slice(0, 3)).toEqual(final);
      expect(raced[3]).toMatchObject({
        action: "minimum.set",
        before_milli_units: null,
        after_milli_units: "18000",
      });
      if (remaining.length === 0) {
        expect(raced).toHaveLength(5);
        expect(raced[4]).toMatchObject({
          action: "minimum.remove",
          before_milli_units: "18000",
          after_milli_units: null,
        });
      } else {
        expect(remaining).toHaveLength(1);
        expect(remaining[0]?.milli_units).toBe("18000");
        expect(raced).toHaveLength(4);
      }
      for (const query of [
        "UPDATE retail.inventory_minimum_audit SET action='minimum.remove'",
        "DELETE FROM retail.inventory_minimum_audit",
        "INSERT INTO retail.inventory_minimum_audit SELECT * FROM retail.inventory_minimum_audit",
      ]) {
        await expect(sql(tenantA, (c) => c.query(query))).rejects.toMatchObject(
          { code: "42501" },
        );
      }
      await expect(
        admin.query(
          "UPDATE retail.inventory_minimum_audit SET action='minimum.remove'",
        ),
      ).rejects.toThrow();
      await expect(
        admin.query("DELETE FROM retail.inventory_minimum_audit"),
      ).rejects.toThrow();
      expect((await audits()).rows).toEqual(raced);
    });
  });

  describe("TASK022 operational reporting", () => {
    const filters = (extra: Partial<ReportFilters> = {}): ReportFilters => ({
      ...reportPeriod("30d"),
      ...extra,
    });
    const repo = (userId = ownerUser, tenantId = tenantA) =>
      new PostgresReporting(apiPool, { userId, tenantId });
    const query = (extra: Partial<ReportFilters> = {}) =>
      repo().operationalReport(filters(extra));
    async function sell(
      method: "cash" | "card" | "mixed" = "cash",
      customerId?: string,
      price = 2000n,
    ) {
      const item =
        price === 2000n
          ? fixtureProduct()
          : createProduct({
              ...fixtureProduct(),
              id: productId(randomUUID()),
              sku: sku(("BIG-" + randomUUID()).toUpperCase()),
              barcode: barcode(randomUUID()),
              salePrice: money(price),
            });
      if (price !== 2000n) {
        await db.createProduct(item);
        await receiveInventory(db, { ...receipt(), productId: item.id });
      }
      const draft = addSaleProduct(
        createSaleDraft(randomUUID(), customerId),
        item,
        quantity("piece", 1000n),
      );
      const payments =
        method === "mixed"
          ? [
              { method: "cash" as const, amount: money(price / 2n) },
              { method: "card" as const, amount: money(price - price / 2n) },
            ]
          : [{ method, amount: money(price) }];
      const value = await completeSaleTransaction(
        new PostgresSales(apiPool, { userId: ownerUser, tenantId: tenantA }),
        {
          shiftId,
          locationId: source,
          draft,
          payments,
          movements: [{ productId: item.id, movementId: randomUUID() }],
        },
      );
      return value.recorded;
    }
    async function returned(saleId: string) {
      return new PostgresSaleReturns(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      }).returnSale(saleId, {
        id: randomUUID(),
        shiftId,
        cashMovementId: randomUUID(),
        lines: [
          {
            saleLineId: product,
            productId: product,
            quantity: quantity("piece", 1000n),
            movementId: randomUUID(),
          },
        ],
        refunds: [{ method: "cash", amount: money(2000n) }],
      });
    }
    it("TASK030 groups exact sale and return totals across a 25-hour configured local day", async () => {
      const times = [
        "2026-11-01T06:59:59Z",
        "2026-11-01T07:00:00Z",
        "2026-11-02T07:59:59Z",
        "2026-11-02T08:00:00Z",
      ];
      let sold: Awaited<ReturnType<typeof sell>> | undefined;
      try {
        for (const time of times) {
          await admin.query(
            "ALTER TABLE retail.sales ALTER COLUMN created_at SET DEFAULT '" +
              time +
              "'::timestamptz",
          );
          const sale = await sell();
          sold ??= sale;
        }
        await admin.query(
          "ALTER TABLE retail.sale_returns ALTER COLUMN created_at SET DEFAULT '2026-11-02T07:00:00Z'::timestamptz",
        );
        await returned(sold!.sale.id);
      } finally {
        await admin.query(
          "ALTER TABLE retail.sales ALTER COLUMN created_at SET DEFAULT clock_timestamp()",
        );
        await admin.query(
          "ALTER TABLE retail.sale_returns ALTER COLUMN created_at SET DEFAULT clock_timestamp()",
        );
      }
      const business = new PostgresBusiness(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      });
      await business.save(
        { ...defaultBusinessProfile, timezone: "America/Tijuana" },
        randomUUID(),
      );
      const tijuana = await query({ from: "2026-11-01", to: "2026-11-01" });
      expect(tijuana.sales).toMatchObject({
        gross: "4000",
        refunds: "2000",
        net: "2000",
        count: "2",
      });
      expect(tijuana.days[0]).toMatchObject({
        date: "2026-11-01",
        gross: "4000",
        refunds: "2000",
      });
      await business.save(defaultBusinessProfile, randomUUID());
      const mexico = await query({ from: "2026-11-01", to: "2026-11-01" });
      expect(mexico.sales).toMatchObject({
        gross: "4000",
        refunds: "0",
        net: "4000",
        count: "2",
      });
    });
    it("empty history yields exact zero summaries and bounded daily rows", async () => {
      const r = await query();
      expect(r.sales).toMatchObject({
        gross: "0",
        count: "0",
        average: "0",
        net: "0",
      });
      expect(r.days).toHaveLength(30);
      expect(r.products).toEqual([]);
      expect(r.purchases.receivedAmount).toBe("0");
    });
    it("totals and mean retain monetary integers above JS safe range", async () => {
      await sell("card", undefined, 9007199254740993n);
      await sell("card", undefined, 9007199254740994n);
      const r = await query();
      expect(r.sales).toMatchObject({
        gross: "18014398509481987",
        average: "9007199254740994",
        count: "2",
        card: "18014398509481987",
        cash: "0",
      });
    });
    it("mixed payments do not multiply sales totals or quantities", async () => {
      await sell("mixed");
      const r = await query();
      expect(r.sales).toMatchObject({
        gross: "2000",
        count: "1",
        cash: "1000",
        card: "1000",
      });
      expect(r.products[0]).toMatchObject({
        quantity: "1000",
        revenue: "2000",
        stock: "9000",
      });
    });
    it("completed returns reduce net by return date and preserve gross", async () => {
      const s = await sell();
      await returned(s.sale.id);
      const r = await query();
      expect(r.sales).toMatchObject({
        gross: "2000",
        refunds: "2000",
        net: "0",
        count: "1",
      });
      expect(r.cash).toMatchObject({ expected: "0", cashOut: "2000" });
      expect(r.products[0]?.stock).toBe("10000");
    });
    it("Mexico presets and daily groupings remain independent of session timezone", async () => {
      await sell();
      const c = await apiPool.connect();
      await c.query("SET TIME ZONE 'Pacific/Auckland'");
      c.release();
      const first = await query();
      const d = await apiPool.connect();
      await d.query("SET TIME ZONE 'UTC'");
      d.release();
      const second = await query();
      expect(first.sales).toEqual(second.sales);
      expect(first.todaySales).toEqual(second.todaySales);
      expect(second.days.find((x) => x.count === "1")?.date).toBe(second.today);
      const boundary = await admin.query(
        "SELECT '2026-10-03'::date::timestamp AT TIME ZONE 'America/Mexico_City' AS start, '2026-10-04'::date::timestamp AT TIME ZONE 'America/Mexico_City' AS finish",
      );
      expect(boundary.rows[0].start.toISOString()).toBe(
        "2026-10-03T06:00:00.000Z",
      );
      expect(boundary.rows[0].finish.toISOString()).toBe(
        "2026-10-04T06:00:00.000Z",
      );
    });

    it("return from an earlier sale produces exact negative net in current period", async () => {
      // Control only the default for new fixtures in this disposable database.
      // Existing ledger rows are never updated and the schema default is restored.
      let sold;
      await admin.query(
        "ALTER TABLE retail.sales ALTER COLUMN created_at SET DEFAULT (clock_timestamp()-interval '2 days')",
      );
      try {
        sold = await sell();
      } finally {
        await admin.query(
          "ALTER TABLE retail.sales ALTER COLUMN created_at SET DEFAULT clock_timestamp()",
        );
      }
      await returned(sold.sale.id);
      const r = await query({ ...reportPeriod("today") });
      expect(r.sales).toMatchObject({
        gross: "0",
        refunds: "2000",
        net: "-2000",
        count: "0",
        average: "0",
      });
    });
    it("actual report includes midnight start and excludes next midnight exactly", async () => {
      for (const timestamp of [
        "2026-10-03T05:59:59Z",
        "2026-10-03T06:00:00Z",
        "2026-10-04T05:59:59Z",
        "2026-10-04T06:00:00Z",
      ]) {
        // Fixed internal timestamp literals, not request values.
        await admin.query(
          `ALTER TABLE retail.sales ALTER COLUMN created_at SET DEFAULT '${timestamp}'::timestamptz`,
        );
        try {
          await sell("card");
        } finally {
          await admin.query(
            "ALTER TABLE retail.sales ALTER COLUMN created_at SET DEFAULT clock_timestamp()",
          );
        }
      }
      const r = await query({ from: "2026-10-03", to: "2026-10-03" });
      expect(r.sales).toMatchObject({
        gross: "4000",
        count: "2",
        card: "4000",
      });
      expect(r.days[0]?.date).toBe("2026-10-03");
    });
    it("date range excludes history without excluding current inventory", async () => {
      await sell();
      const r = await query({ from: "2020-01-01", to: "2020-01-01" });
      expect(r.sales.gross).toBe("0");
      expect(r.todaySales.gross).toBe("2000");
      expect(r.products).toEqual([]);
      expect(r.inventory.empty).toBe("0");
    });
    it("location isolates sales and reports absent balances as zero stock", async () => {
      await new PostgresInventoryMinimum(apiPool, {
        tenantId: tenantA,
        userId: ownerUser,
      }).setMinimum(product, destination, quantity("piece", 1000n));
      await sell();
      const r = await query({ locationId: destination });
      expect(r.sales.count).toBe("0");
      expect(r.inventory.empty).toBe("1");
      expect(r.inventory.alerts[0]?.stock).toBe("0");
    });
    it("product and payment select whole matching transactions explicitly", async () => {
      await sell("mixed");
      await sell("card");
      const cash = await query({ productId: product, paymentMethod: "cash" });
      expect(cash.sales).toMatchObject({
        gross: "2000",
        count: "1",
        cash: "1000",
        card: "1000",
      });
      expect(cash.products[0]?.quantity).toBe("1000");
    });
    it("inactive historical customer groups correctly versus public general", async () => {
      const customers = new PostgresCustomers(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      });
      const c = await customers.createCustomer(randomUUID(), {
        name: "Customer",
        status: "active",
      });
      await sell("cash", c.id);
      await sell("card");
      await customers.updateCustomer(c.id, { status: "inactive" });
      expect((await query()).sales).toMatchObject({
        customers: "1",
        associated: "1",
        general: "1",
      });
      expect((await query({ customerId: c.id })).sales).toMatchObject({
        gross: "2000",
        associated: "1",
        general: "0",
      });
    });
    it("stock minimum is configured per pair and separate from exhausted", async () => {
      const minimum = new PostgresInventoryMinimum(apiPool, {
        tenantId: tenantA,
        userId: ownerUser,
      });
      await minimum.setMinimum(product, source, quantity("piece", 10000n));
      const r = await query();
      expect(r.inventory).toMatchObject({ low: "1", empty: "0" });
      await minimum.setMinimum(product, source, quantity("piece", 9000n));
      expect((await query()).inventory.low).toBe("0");
      await minimum.setMinimum(product, source, null);
      expect((await query()).inventory.alerts).toEqual([]);
    });
    it("purchase statuses costs and receipts use supplier snapshot independently of sales", async () => {
      const p = new PostgresPurchasing(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      });
      const supplier = await p.createSupplier(randomUUID(), {
        name: "Supplier",
        status: "active",
      });
      const draft = await p.createPurchase({
        id: randomUUID(),
        supplierId: supplier.id,
        locationId: source,
        lines: [
          {
            productId: product,
            quantityOrdered: quantity("piece", 10000n),
            unitCost: money(777n),
          },
        ],
      });
      await p.changePurchase(draft.id, "order");
      await p.receivePurchaseOrder(draft.id, {
        id: randomUUID(),
        lines: [{ productId: product, quantity: quantity("piece", 4000n) }],
      });
      const r = await query({ supplierId: supplier.id });
      expect(r.purchases).toMatchObject({
        created: "1",
        pending: "0",
        partial: "1",
        received: "0",
        orderedAmount: "7770",
        receivedAmount: "3108",
      });
      expect(r.sales.gross).toBe("0");
    });
    it("cash ledger and close snapshots reflect shortage without changing movements", async () => {
      const cash = new PostgresCash(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      });
      await cash.moveCash({
        id: randomUUID(),
        shiftId,
        type: "cash_in",
        amount: money(500n),
        reason: "Float",
      });
      await cash.moveCash({
        id: randomUUID(),
        shiftId,
        type: "cash_out",
        amount: money(100n),
        reason: "Expense",
      });
      await cash.closeShift(shiftId, money(350n));
      const r = await query();
      expect(r.cash).toMatchObject({
        open: "0",
        closed: "1",
        expected: "400",
        shortage: "50",
        surplus: "0",
        cashIn: "500",
        cashOut: "100",
      });
      const rows = await admin.query(
        "SELECT count(*)::text AS n FROM retail.cash_movements WHERE tenant_id=$1",
        [tenantA],
      );
      expect(rows.rows[0]?.n).toBe("2");
    });
    it("owner admin allowed while clerk outsider and revoked owner denied", async () => {
      expect(
        (await repo(adminUser).operationalReport(filters())).sales.count,
      ).toBe("0");
      for (const user of [clerkUser, outsiderUser]) {
        await expect(
          repo(user).operationalReport(filters()),
        ).rejects.toBeInstanceOf(PermissionDeniedError);
        await expect(repo(user).reportOptions()).rejects.toBeInstanceOf(
          PermissionDeniedError,
        );
      }
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND user_id=$2",
        [tenantA, ownerUser],
      );
      await expect(query()).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("RLS hides other tenant and all foreign filter references fail closed", async () => {
      await sell();
      expect(
        (await repo(ownerUser, tenantB).operationalReport(filters())).sales
          .gross,
      ).toBe("0");
      const customers = new PostgresCustomers(pool, {
          userId: ownerUser,
          tenantId: tenantB,
        }),
        suppliers = new PostgresPurchasing(pool, {
          userId: ownerUser,
          tenantId: tenantB,
        });
      const c = await customers.createCustomer(randomUUID(), {
          name: "Foreign",
          status: "active",
        }),
        v = await suppliers.createSupplier(randomUUID(), {
          name: "Foreign",
          status: "active",
        });
      for (const extra of [
        { customerId: c.id },
        { supplierId: v.id },
        { productId: randomUUID() },
        { locationId: randomUUID() },
      ])
        await expect(query(extra)).rejects.toBeInstanceOf(
          PermissionDeniedError,
        );
    });
    it("report permission independently denies even when all underlying reads remain", async () => {
      await admin.query(
        "DELETE FROM retail.role_permissions WHERE role='owner' AND permission='reports.read'",
      );
      try {
        await expect(query()).rejects.toBeInstanceOf(PermissionDeniedError);
      } finally {
        await admin.query(
          "INSERT INTO retail.role_permissions VALUES('owner','reports.read')",
        );
      }
    });
    it("selectors are bounded and read-only transaction uses repeatable snapshot", async () => {
      const options = await repo().reportOptions();
      expect(options.locations).toHaveLength(2);
      expect(options.products).toHaveLength(1);
      class Inspect extends PostgresReporting {
        inspect() {
          return this.transaction(
            "reports.read",
            async (c) =>
              (
                await c.query(
                  "SELECT current_setting('transaction_read_only') AS ro,current_setting('transaction_isolation') AS isolation",
                )
              ).rows[0],
            true,
          );
        }
      }
      expect(
        await new Inspect(apiPool, {
          userId: ownerUser,
          tenantId: tenantA,
        }).inspect(),
      ).toMatchObject({ ro: "on", isolation: "repeatable read" });
    });
  });

  describe("TASK025 cashier assignments", () => {
    const ctx = { tenantId: tenantA, userId: outsiderUser };
    const cashierDb = () => new PostgresInventory(apiPool, ctx);
    const cashierCash = () => new PostgresCash(apiPool, ctx);
    const members = () =>
      new PostgresMembers(pool, { tenantId: tenantA, userId: ownerUser });
    const update = (
      extra: Partial<{
        role: "cashier" | "admin" | "inventory_clerk";
        status: "active" | "inactive";
        locationIds: string[];
      }> = {},
    ) =>
      members().updateMember(outsiderUser, {
        displayName: "Cajero prueba",
        role: "cashier",
        status: "active",
        locationIds: [source],
        ...extra,
      });
    const checkout = (locationId = source): SaleCheckoutInput => {
      const draft = addSaleProduct(
        createSaleDraft(randomUUID()),
        fixtureProduct(),
        quantity("piece", 1000n),
      );
      return {
        draft,
        locationId,
        shiftId,
        payments: [{ method: "card", amount: draft.total }],
        movements: [{ productId: product, movementId: randomUUID() }],
      };
    };
    const sell = (input = checkout()) =>
      completeSaleTransaction(new PostgresSales(apiPool, ctx), input);
    beforeEach(async () => {
      await admin.query(
        "INSERT INTO retail.tenant_memberships(tenant_id,user_id,role,status,display_name) VALUES($1,$2,'cashier','active','Cajero prueba')",
        [tenantA, outsiderUser],
      );
      await admin.query(
        "INSERT INTO retail.member_locations VALUES($1,$2,$3)",
        [tenantA, outsiderUser, source],
      );
    });
    it("has precisely the cashier matrix without manual inventory or administration writes", async () => {
      const permissions = (
        await listTenantMemberships(apiPool, outsiderUser)
      )[0]!.permissions;
      expect([...permissions].sort()).toEqual(
        [
          "products.read",
          "sales.discount",
          "customers.read",
          "customers.write",
          "receivables.read",
          "receivables.pay",
          "expenses.read",
          "sales.read",
          "sales.create",
          "cash.read",
          "cash.open",
          "cash.move",
          "cash.close",
          "locations.read",
          "inventory.read",
        ].sort(),
      );
      for (const p of [
        "reports.read",
        "sales.return",
        "products.write",
        "members.manage",
        "inventory.issue",
        "inventory.adjust",
        "suppliers.write",
        "purchases.write",
      ] as Permission[])
        await expect(cashierDb().authorize(p)).rejects.toBeInstanceOf(
          PermissionDeniedError,
        );
    });
    it("returns actual assigned locations during tenant discovery", async () => {
      expect(
        (await listTenantMemberships(apiPool, outsiderUser))[0],
      ).toMatchObject({
        role: "cashier",
        displayName: "Cajero prueba",
        userId: outsiderUser,
        locationIds: [source],
        allLocations: false,
      });
    });
    it("lists only the assigned location and its stock", async () => {
      expect((await cashierDb().listLocations()).map((l) => l.id)).toEqual([
        source,
      ]);
      expect(
        (await cashierDb().listStock()).every(
          (s) => s.balance.locationId === source,
        ),
      ).toBe(true);
    });
    it("owner and admin retain all locations", async () => {
      expect(await db.listLocations()).toHaveLength(2);
      expect(
        await new PostgresInventory(apiPool, {
          tenantId: tenantA,
          userId: adminUser,
        }).listLocations(),
      ).toHaveLength(2);
    });
    it("denies foreign requested stock and manual inventory issue", async () => {
      await expect(cashierDb().listStock(destination)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(issueInventory(cashierDb(), issue())).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
    it("denies foreign cash reads and opening", async () => {
      await expect(
        cashierCash().currentShift(destination),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        cashierCash().openShift({
          id: randomUUID(),
          locationId: destination,
          openingCash: money(0n),
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("denies a sale with manipulated location", async () => {
      await expect(sell(checkout(destination))).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      expect(await stock()).toBe(10000n);
    });
    it("inactive membership cannot read or sell", async () => {
      await update({ status: "inactive" });
      await expect(cashierDb().listLocations()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(sell()).rejects.toBeInstanceOf(PermissionDeniedError);
      expect(await listTenantMemberships(apiPool, outsiderUser)).toEqual([]);
    });
    it("unassigned cashier has no locations and cannot open cash", async () => {
      await update({ locationIds: [] });
      expect(await cashierDb().listLocations()).toEqual([]);
      await expect(
        cashierCash().openShift({
          id: randomUUID(),
          locationId: source,
          openingCash: money(0n),
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("management changes role and assignment atomically", async () => {
      expect(
        await update({ role: "inventory_clerk", locationIds: [destination] }),
      ).toMatchObject({ role: "inventory_clerk", locationIds: [destination] });
      expect((await cashierDb().listLocations()).map((l) => l.id)).toEqual([
        destination,
      ]);
      await expect(
        cashierDb().authorize("sales.create"),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("denies a management target in a different tenant", async () => {
      const id = randomUUID();
      await admin.query(
        "INSERT INTO retail.tenant_memberships(tenant_id,user_id,role,status) VALUES($1,$2,'cashier','active')",
        [tenantB, id],
      );
      await expect(
        members().updateMember(id, {
          role: "cashier",
          status: "active",
          displayName: "Otro",
          locationIds: [source],
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("denies a location belonging only to another tenant", async () => {
      const foreign = inventoryLocationId(randomUUID());
      await other.createLocation(
        createInventoryLocation({
          id: foreign,
          name: inventoryLocationName("Ajena"),
          code: inventoryLocationCode("FOREIGN"),
          status: "active",
        }),
      );
      await expect(update({ locationIds: [foreign] })).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      expect((await cashierDb().listLocations()).map((l) => l.id)).toEqual([
        source,
      ]);
    });
    it("protects owner and self and denies owner elevation", async () => {
      const body = {
        role: "admin" as const,
        status: "inactive" as const,
        displayName: "Cambio",
        locationIds: [],
      };
      await expect(
        members().updateMember(ownerUser, body),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        new PostgresMembers(pool, {
          tenantId: tenantA,
          userId: adminUser,
        }).updateMember(adminUser, body),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "SELECT retail.update_member($1,'owner','active','Owner',ARRAY[]::uuid[],$2)",
            [outsiderUser, randomUUID()],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("runtime cannot directly edit memberships or assignments", async () => {
      await expect(
        sql(
          tenantA,
          (c) =>
            c.query(
              "UPDATE retail.tenant_memberships SET role='admin' WHERE user_id=$1",
              [outsiderUser],
            ),
          outsiderUser,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        sql(
          tenantA,
          (c) =>
            c.query("INSERT INTO retail.member_locations VALUES($1,$2,$3)", [
              tenantA,
              outsiderUser,
              destination,
            ]),
          outsiderUser,
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("raw RLS hides foreign balances, movements and cash shifts", async () => {
      const cash = await new PostgresCash(pool, {
        tenantId: tenantA,
        userId: ownerUser,
      }).openShift({
        id: randomUUID(),
        locationId: destination,
        openingCash: money(0n),
      });
      const result = await sql(
        tenantA,
        async (c) => ({
          balances: (
            await c.query(
              "SELECT * FROM retail.stock_balances WHERE location_id=$1",
              [destination],
            )
          ).rows,
          cash: (
            await c.query(
              "SELECT * FROM retail.cash_register_shifts WHERE id=$1",
              [cash.id],
            )
          ).rows,
        }),
        outsiderUser,
      );
      expect(result).toEqual({ balances: [], cash: [] });
    });
    it("raw unlinked issue is denied by RLS", async () => {
      await expect(
        sql(
          tenantA,
          (c) =>
            c.query(
              "INSERT INTO retail.inventory_movements(id,tenant_id,product_id,location_id,type,unit,amount,balance_after) VALUES($1,$2,$3,$4,'issue','piece',1000,9000)",
              [randomUUID(), tenantA, product, source],
            ),
          outsiderUser,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      expect(await stock()).toBe(10000n);
    });
    it("sale-linked issue without complete sale rolls back the ledger", async () => {
      await expect(
        sql(
          tenantA,
          async (c) => {
            const id = randomUUID();
            await c.query(
              "INSERT INTO retail.inventory_commands VALUES($1,$2,'issue')",
              [id, tenantA],
            );
            await c.query(
              "INSERT INTO retail.inventory_movements(id,tenant_id,product_id,location_id,type,unit,amount,balance_after,sale_id) VALUES($1,$2,$3,$4,'issue','piece',1000,9000,$5)",
              [id, tenantA, product, source, randomUUID()],
            );
          },
          outsiderUser,
        ),
      ).rejects.toThrow();
      expect(await stock()).toBe(10000n);
    });
    it("cashier sale records actor and branch snapshots with exact stock", async () => {
      const sale = (await sell()).recorded;
      expect(sale).toMatchObject({
        createdBy: outsiderUser,
        createdByName: "Cajero prueba",
        locationName: "Almac\u00e9n",
        locationId: source,
      });
      expect(await stock()).toBe(9000n);
    });
    it("replays a sale exactly and denies retry after assignment revocation", async () => {
      const input = checkout();
      await sell(input);
      expect((await sell(input)).replayed).toBe(true);
      expect(await stock()).toBe(9000n);
      await update({ locationIds: [destination] });
      await expect(sell(input)).rejects.toBeInstanceOf(PermissionDeniedError);
      expect(await stock()).toBe(9000n);
    });
    it("historical sale names survive inactive membership", async () => {
      const sale = (await sell()).recorded;
      await update({ status: "inactive" });
      expect(
        await new PostgresSales(pool, {
          tenantId: tenantA,
          userId: ownerUser,
        }).readSale(sale.sale.id),
      ).toMatchObject({
        createdByName: "Cajero prueba",
        createdBy: outsiderUser,
      });
    });
    it("opening and closing a cashier shift keep operator names", async () => {
      await new PostgresCash(pool, {
        tenantId: tenantA,
        userId: ownerUser,
      }).closeShift(shiftId, money(0n));
      const c = cashierCash();
      const opened = await c.openShift({
        id: randomUUID(),
        locationId: source,
        openingCash: money(0n),
      });
      expect(opened).toMatchObject({
        openedBy: outsiderUser,
        openedByName: "Cajero prueba",
      });
      expect(await c.closeShift(opened.id, money(0n))).toMatchObject({
        closedBy: outsiderUser,
        closedByName: "Cajero prueba",
        openedByName: "Cajero prueba",
      });
    });
    it("allows several assigned locations and revokes one without fallback", async () => {
      await update({ locationIds: [source, destination] });
      expect(await cashierDb().listLocations()).toHaveLength(2);
      await update({ locationIds: [destination] });
      expect((await cashierDb().listLocations()).map((l) => l.id)).toEqual([
        destination,
      ]);
      await expect(cashierCash().currentShift(source)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
    it("writes immutable membership audit with server actor and correlation", async () => {
      const cid = randomUUID();
      await new PostgresMembers(
        pool,
        { tenantId: tenantA, userId: ownerUser },
        cid,
      ).updateMember(outsiderUser, {
        role: "cashier",
        status: "inactive",
        displayName: "Nombre privado",
        locationIds: [source],
      });
      const audit = (
        await admin.query(
          "SELECT * FROM retail.membership_audit WHERE correlation_id=$1",
          [cid],
        )
      ).rows[0];
      expect(audit).toMatchObject({
        actor_user_id: ownerUser,
        user_id: outsiderUser,
        action: "members.update",
        correlation_id: cid,
      });
      expect(JSON.stringify(audit.metadata)).not.toContain("Nombre privado");
      await expect(
        admin.query(
          "UPDATE retail.membership_audit SET action='members.update'",
        ),
      ).rejects.toThrow();
    });
    it("revocation waits for the authorized operation then blocks new operations", async () => {
      let ready!: () => void, release!: () => void;
      const started = new Promise<void>((r) => (ready = r)),
        pending = new Promise<void>((r) => (release = r));
      class Holding extends PostgresInventory {
        hold() {
          return this.transaction("sales.create", async () => {
            ready();
            await pending;
          });
        }
      }
      const held = new Holding(pool, ctx).hold();
      await started;
      const changed = update({ status: "inactive" });
      try {
        let blocked = false;
        for (let i = 0; i < 40; i++) {
          blocked = (
            await admin.query(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT retail.update_member%') b",
            )
          ).rows[0].b;
          if (blocked) break;
          await new Promise((r) => setTimeout(r, 20));
        }
        expect(blocked).toBe(true);
      } finally {
        release();
      }
      await held;
      await changed;
      await expect(
        cashierDb().authorize("sales.create"),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("rejects accidental membership in the privileged guard role", async () => {
      await admin.query("GRANT smartretail_members_guard TO smartretail_api");
      try {
        await expect(cashierDb().listProducts()).rejects.toThrow(
          "Unsafe database application role",
        );
      } finally {
        await admin.query(
          "REVOKE smartretail_members_guard FROM smartretail_api",
        );
      }
    });
  });
  describe("TASK027 configurable taxes", () => {
    const taxes = (userId = ownerUser, tenantId = tenantA) =>
      new PostgresTaxes(apiPool, { userId, tenantId });
    const sales = () =>
      new PostgresSales(apiPool, { userId: ownerUser, tenantId: tenantA });
    const profileInput = (rate = "775") => ({
      id: randomUUID(),
      name: "SMOKE Tax",
      rate,
      active: true,
    });
    async function assign(rate = "775") {
      const input = profileInput(rate);
      await taxes().saveTaxProfile(input);
      await updateProduct(db, product, { taxProfileId: input.id });
      return input;
    }
    const command = (
      paid = 2155n,
      amount = 1000n,
      discounts?: DiscountIntent,
    ): SaleCheckoutInput => ({
      draft: addSaleProduct(
        createSaleDraft(randomUUID()),
        fixtureProduct(),
        quantity("piece", amount),
      ),
      locationId: source,
      shiftId,
      movements: [{ productId: product, movementId: randomUUID() }],
      payments: paid ? [{ method: "card", amount: money(paid) }] : [],
      ...(discounts ? { discounts } : {}),
    });
    const expected = (
      input: SaleCheckoutInput,
      p: { id: string; rate: string },
    ) => ({
      ...input,
      taxes: [{ productId: product, profileId: p.id, rate: BigInt(p.rate) }],
    });
    const sell = (input: SaleCheckoutInput) =>
      completeSaleTransaction(sales(), input);
    it("creates updates and audits profiles and assignment with restricted runtime", async () => {
      const p = await assign();
      await taxes().saveTaxProfile({ ...p, name: "Changed" }, true);
      expect((await taxes().listTaxProfiles())[0]?.name).toBe("Changed");
      expect(
        (
          await admin.query(
            "SELECT operation FROM retail.promotion_audit ORDER BY created_at",
          )
        ).rows.map((r) => r.operation),
      ).toEqual(["taxes.create", "products.tax", "taxes.update"]);
      await updateProduct(db, product, { name: productName("Ordinary edit") });
      expect((await db.listProducts())[0]?.taxProfileId).toBe(p.id);
    });
    it("permits owner admin but denies clerk and inactive administration", async () => {
      await taxes(adminUser).saveTaxProfile(profileInput());
      await expect(
        taxes(clerkUser).saveTaxProfile(profileInput()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND user_id=$2",
        [tenantA, adminUser],
      );
      await expect(
        taxes(adminUser).saveTaxProfile(profileInput()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("isolates profiles and rejects cross-tenant assignment", async () => {
      const p = profileInput();
      await taxes(ownerUser, tenantB).saveTaxProfile(p);
      expect(await taxes().listTaxProfiles()).toEqual([]);
      await expect(
        updateProduct(db, product, { taxProfileId: p.id }),
      ).rejects.toThrow();
      await expect(taxes().saveTaxProfile(p, true)).rejects.toThrow();
    });
    it("preserves unassigned sales and stores tax version zero", async () => {
      const result = await sell(command(2000n));
      expect(result.recorded.sale.total.minorUnits).toBe(2000n);
      expect(
        (await admin.query("SELECT tax_version FROM retail.sales")).rows[0]
          .tax_version,
      ).toBe(0);
    });
    it("quotes current tax and persists exact exclusive snapshots", async () => {
      const p = await assign(),
        input = expected(command(), p);
      expect((await sales().quoteSale(input)).sale.total.minorUnits).toBe(
        2155n,
      );
      const result = await sell(input);
      expect(result.recorded.sale.lines[0]?.tax?.amount.minorUnits).toBe(155n);
      expect(await sales().readSale(input.draft.id)).toEqual(result.recorded);
    });
    it("applies promotion manual and coupon before taxes", async () => {
      const p = await assign(),
        promo = new PostgresPromotions(apiPool, {
          userId: ownerUser,
          tenantId: tenantA,
        });
      await promo.savePromotion({
        id: randomUUID(),
        name: "SMOKE Promo",
        productId: product,
        discount: { type: "percentage", value: "1000" },
        active: true,
      });
      await promo.saveCoupon({
        id: randomUUID(),
        code: "SMOKE-TAX",
        discount: { type: "percentage", value: "1000" },
        active: true,
      });
      const result = await sell(
        expected(
          command(4713n, 3000n, {
            sale: discount("percentage", 1000n),
            couponCode: "SMOKE-TAX",
          }),
          p,
        ),
      );
      expect(result.recorded.sale.lines[0]?.tax?.base.minorUnits).toBe(4374n);
      expect(result.recorded.sale.lines[0]?.discount?.minorUnits).toBe(1626n);
    });
    it("rejects missing incomplete or fabricated expectations and rolls back stock", async () => {
      const p = await assign();
      for (const input of [
        command(),
        { ...command(), taxes: [] },
        expected(command(), { ...p, rate: "776" }),
        expected(command(), { ...p, id: randomUUID() }),
      ])
        await expect(sell(input)).rejects.toBeInstanceOf(SaleQuoteChangedError);
      expect(await stock()).toBe(10000n);
    });
    it("detects changed rate even when rounded tax remains the same", async () => {
      const p = await assign("0");
      const input = expected(command(2000n), p);
      await taxes().saveTaxProfile({ ...p, rate: "1" }, true);
      await expect(sell(input)).rejects.toBeInstanceOf(SaleQuoteChangedError);
    });
    it("replays historical snapshots after rate edits deactivation and unassignment", async () => {
      const p = await assign(),
        input = expected(command(), p),
        original = await sell(input);
      await taxes().saveTaxProfile({ ...p, rate: "1234", active: false }, true);
      await updateProduct(db, product, { taxProfileId: null });
      expect(await sell(input)).toEqual({
        recorded: original.recorded,
        replayed: true,
      });
      expect(await stock()).toBe(9000n);
    });
    it("conflicts same SaleId with a different fiscal expectation", async () => {
      const p = await assign(),
        input = expected(command(), p);
      await sell(input);
      await expect(
        sell(expected(input, { ...p, rate: "776" })),
      ).rejects.toBeInstanceOf(SaleIdempotencyConflictError);
    });
    it("blocks newly assigned or inactive profiles at confirmation", async () => {
      const input = { ...command(2000n), taxes: [] },
        p = await assign();
      await expect(sell(input)).rejects.toBeInstanceOf(SaleQuoteChangedError);
      await taxes().saveTaxProfile({ ...p, active: false }, true);
      await expect(sell(expected(command(), p))).rejects.toThrow();
      await expect(
        updateProduct(db, product, { taxProfileId: null }).then(() =>
          updateProduct(db, product, { taxProfileId: p.id }),
        ),
      ).rejects.toThrow();
    });
    async function omittedTax(immediate: boolean) {
      const input = command(2000n);
      return sql(tenantA, async (c) => {
        await c.query(
          "INSERT INTO retail.sales(id,tenant_id,location_id,status,total_minor_units,created_by,command_payload,shift_id) VALUES($1,$2,$3,'completed',2000,$4,'{}',$5)",
          [input.draft.id, tenantA, source, ownerUser, shiftId],
        );
        if (immediate)
          await c.query(
            "SET CONSTRAINTS retail.sale_tax_complete,retail.sale_line_tax_complete IMMEDIATE",
          );
        const m = input.movements[0]!.movementId;
        await c.query(
          "INSERT INTO retail.inventory_commands(id,tenant_id,kind) VALUES($1,$2,'issue')",
          [m, tenantA],
        );
        await c.query(
          "INSERT INTO retail.inventory_movements(id,tenant_id,product_id,location_id,type,unit,amount,balance_after,sale_id) VALUES($1,$2,$3,$4,'issue','piece',1000,9000,$5)",
          [m, tenantA, product, source, input.draft.id],
        );
        await c.query(
          "INSERT INTO retail.sale_lines(tenant_id,sale_id,product_id,ordinal,sku,product_name,unit,quantity_milli_units,unit_price_minor_units,line_total_minor_units,movement_id) VALUES($1,$2,$3,0,'SKU-1','Producto','piece',1000,2000,2000,$4)",
          [tenantA, input.draft.id, product, m],
        );
        await c.query(
          "INSERT INTO retail.sale_payments(tenant_id,sale_id,method,amount_minor_units) VALUES($1,$2,'card',2000)",
          [tenantA, input.draft.id],
        );
      });
    }
    it("SQL rejects tax omission disguised as a legacy sale", async () => {
      await assign();
      await expect(omittedTax(false)).rejects.toThrow();
      expect(await stock()).toBe(10000n);
    });
    it("SQL rejects omission after tax constraints are immediate", async () => {
      await assign("0");
      await expect(omittedTax(true)).rejects.toThrow();
      expect(await stock()).toBe(10000n);
    });
    it("refunds historical net and tax after profile changes and closes exactly", async () => {
      const p = await assign(),
        input = expected(
          command(4713n, 3000n, { sale: discount("amount", 1626n) }),
          p,
        );
      await sell(input);
      await taxes().saveTaxProfile({ ...p, rate: "999", active: false }, true);
      const r = new PostgresSaleReturns(apiPool, {
        tenantId: tenantA,
        userId: ownerUser,
      });
      const returnInput = (amount: bigint, paid: bigint): SaleReturnInput => ({
        id: randomUUID(),
        lines: [
          {
            saleLineId: product,
            productId: product,
            quantity: quantity("piece", amount),
            movementId: randomUUID(),
          },
        ],
        refunds: [{ method: "card", amount: money(paid) }],
      });
      const a = await r.returnSale(input.draft.id, returnInput(1000n, 1571n)),
        b = await r.returnSale(input.draft.id, returnInput(2000n, 3142n));
      expect(a.record.lines[0]?.refundedTax?.minorUnits).toBe(113n);
      expect(b.record.lines[0]?.refundedTax?.minorUnits).toBe(226n);
      expect(await stock()).toBe(10000n);
    });
    it("reports commercial values and taxes once despite split payments", async () => {
      const p = await assign(),
        input = expected(command(), p);
      await sell({
        ...input,
        payments: [
          { method: "cash", amount: money(1000n) },
          { method: "card", amount: money(1155n) },
        ],
      });
      const report = await new PostgresReporting(apiPool, {
        tenantId: tenantA,
        userId: ownerUser,
      }).operationalReport(reportPeriod("today"));
      expect(report.sales).toMatchObject({
        gross: "2155",
        baseGross: "2000",
        taxCollected: "155",
        taxRefunded: "0",
        netCommercial: "2000",
        discounts: "0",
      });
      expect(report.products[0]?.revenue).toBe("2000");
    });
    it("serializes a rate update and returns the committed current quote", async () => {
      const p = await assign(),
        c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(
          "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
          [tenantA, ownerUser],
        );
        await c.query(
          "UPDATE retail.tax_profiles SET rate=1000 WHERE tenant_id=$1 AND id=$2",
          [tenantA, p.id],
        );
        const blocker = (
          await c.query<{ pid: number }>("SELECT pg_backend_pid() pid")
        ).rows[0]!.pid;
        let settled = false;
        const quote = sales()
          .quoteSale(command())
          .finally(() => {
            settled = true;
          });
        const deadline = Date.now() + 5000;
        let waiting = false;
        while (!waiting && Date.now() < deadline) {
          waiting = (
            await admin.query<{ waiting: boolean }>(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='smartretail_api' AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))) waiting",
              [blocker],
            )
          ).rows[0]!.waiting;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(waiting).toBe(true);
        expect(settled).toBe(false);
        await c.query("COMMIT");
        expect((await quote).sale.total.minorUnits).toBe(2200n);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
    it("rejects overflow and leaves sale stock and payment ledger untouched", async () => {
      const p = await assign("1000000");
      await updateProduct(db, product, {
        salePrice: money(92233720368547758n),
      });
      const current = (await db.listProducts())[0]!;
      const input = expected(
        {
          ...command(),
          draft: addSaleProduct(
            createSaleDraft(randomUUID()),
            current,
            quantity("piece", 1000n),
          ),
          payments: [
            { method: "card", amount: money(92233720368547758n * 101n) },
          ],
        },
        p,
      );
      await expect(sell(input)).rejects.toThrow();
      expect(await stock()).toBe(10000n);
      expect(
        (await admin.query("SELECT count(*)::int n FROM retail.sales")).rows[0]
          .n,
      ).toBe(0);
    });
  });
  describe("TASK026 transactional discounts", () => {
    const catalog = (userId = ownerUser, tenantId = tenantA) =>
      new PostgresPromotions(pool, { userId, tenantId });
    const saleRepo = (userId = ownerUser) =>
      new PostgresSales(pool, { tenantId: tenantA, userId });
    const couponInput = (value = "1000", usageLimit = "3") => ({
      id: randomUUID(),
      code: "SMOKE-" + randomUUID().slice(0, 8).toUpperCase(),
      discount: { type: "percentage" as const, value },
      active: true,
      usageLimit,
    });
    const promoInput = (value = "1000") => ({
      id: randomUUID(),
      name: "SMOKE Promotion",
      productId: product,
      discount: { type: "percentage" as const, value },
      active: true,
    });
    const command = (
      paid = 2000n,
      discounts?: DiscountIntent,
      locationId: string = source,
      openedShift = shiftId,
      amount = 1000n,
    ): SaleCheckoutInput => ({
      draft: addSaleProduct(
        createSaleDraft(randomUUID()),
        fixtureProduct(),
        quantity("piece", amount),
      ),
      locationId,
      shiftId: openedShift,
      payments: paid === 0n ? [] : [{ method: "card", amount: money(paid) }],
      movements: [{ productId: product, movementId: randomUUID() }],
      ...(discounts === undefined ? {} : { discounts }),
    });
    const sell = (input: SaleCheckoutInput, userId = ownerUser) =>
      completeSaleTransaction(saleRepo(userId), input);
    beforeEach(async () => {
      await admin.query(
        "INSERT INTO retail.tenant_memberships(tenant_id,user_id,role,status,display_name) VALUES($1,$2,'cashier','active','Cajero descuentos')",
        [tenantA, outsiderUser],
      );
      await admin.query(
        "INSERT INTO retail.member_locations(tenant_id,user_id,location_id) VALUES($1,$2,$3)",
        [tenantA, outsiderUser, source],
      );
    });
    it("creates edits and audits tenant-normalized catalog with unique coupon codes", async () => {
      const c = { ...couponInput(), code: " smoke-case " };
      const saved = await catalog().saveCoupon(c);
      expect(saved.code).toBe("SMOKE-CASE");
      expect(saved.uses).toBe("0");
      await catalog().saveCoupon(
        { ...c, code: "SMOKE-CASE", active: false },
        true,
      );
      expect((await catalog().listCoupons())[0]?.active).toBe(false);
      await expect(
        catalog().saveCoupon({ ...c, id: randomUUID() }),
      ).rejects.toBeInstanceOf(DatabaseUniquenessConflictError);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.promotion_audit WHERE tenant_id=$1 AND actor_user_id=$2",
            [tenantA, ownerUser],
          )
        ).rows[0].n,
      ).toBe(2);
    });
    it("permits owner admin catalogs and denies cashier and clerk administration", async () => {
      await catalog(adminUser).savePromotion(promoInput());
      for (const user of [outsiderUser, clerkUser]) {
        await expect(catalog(user).listCoupons()).rejects.toBeInstanceOf(
          PermissionDeniedError,
        );
        await expect(
          catalog(user).saveCoupon(couponInput()),
        ).rejects.toBeInstanceOf(PermissionDeniedError);
      }
    });
    it("prevents cross-tenant product promotion and coupon lookup", async () => {
      const foreign = randomUUID();
      await other.createProduct(
        fixtureProduct(productId(foreign), foreign.toUpperCase(), null),
      );
      await expect(
        catalog().savePromotion({ ...promoInput(), productId: foreign }),
      ).rejects.toThrow();
      const c = couponInput();
      await catalog(ownerUser, tenantB).saveCoupon(c);
      await expect(
        sell(command(1800n, { couponCode: c.code })),
      ).rejects.toBeInstanceOf(DiscountUnavailableError);
    });
    it("rebuilds automatic promotions and manual line replacement from the current catalog", async () => {
      await catalog().savePromotion(promoInput("5000"));
      const automatic = command(1000n);
      const quote = await saleRepo().quoteSale(automatic);
      expect(quote.sale.total.minorUnits).toBe(1000n);
      const result = await sell(
        command(1800n, {
          lines: [{ productId: product, discount: discount("amount", 200n) }],
        }),
      );
      expect(result.recorded.sale.total.minorUnits).toBe(1800n);
      expect(result.recorded.details?.lines[0]?.source).toBe("manual");
      expect(await stock()).toBe(9000n);
    });
    it("enforces cashier 20 percent including combined fixed and percentage intents", async () => {
      await expect(
        sell(
          command(1580n, { sale: discount("percentage", 2100n) }),
          outsiderUser,
        ),
      ).rejects.toBeInstanceOf(DiscountLimitError);
      await expect(
        sell(
          command(1280n, {
            sale: discount("percentage", 2000n),
            lines: [{ productId: product, discount: discount("amount", 400n) }],
          }),
          outsiderUser,
        ),
      ).rejects.toBeInstanceOf(DiscountLimitError);
      const pass = await sell(
        command(1600n, { sale: discount("percentage", 2000n) }),
        outsiderUser,
      );
      expect(pass.recorded.sale.total.minorUnits).toBe(1600n);
    });
    it("owner can exceed the cashier cap with exact persisted snapshots", async () => {
      const result = await sell(
        command(500n, { sale: discount("percentage", 7500n) }),
      );
      expect(result.recorded.sale.lines[0]?.discount?.minorUnits).toBe(1500n);
      const reread = await saleRepo().readSale(result.recorded.sale.id);
      expect(reread.details).toEqual(result.recorded.details);
      expect(reread.sale.total.minorUnits).toBe(500n);
    });
    async function rawSale(user: string, forgedPromotion = false) {
      const input = command(100n, { sale: discount("percentage", 9500n) }),
        priced = priceDiscountedSale(input.draft, input.discounts);
      const noManual = { ...priced.details! };
      delete noManual.manualSale;
      const details = forgedPromotion
        ? {
            ...noManual,
            saleDiscountTotal: "0",
            lines: priced.details!.lines.map((l) => ({
              ...l,
              source: "promotion" as const,
              promotionId: randomUUID(),
              promotionName: "Forged",
              lineDiscount: "1900",
              saleAllocation: "0",
            })),
          }
        : priced.details;
      return saleRepo(user).runSale(input.draft.id, async (tx) => {
        await tx.lockOpenShift(source, shiftId);
        await tx.lockBalances([product], source);
        const issue = createInventoryIssue({
          id: inventoryMovementId(input.movements[0]!.movementId),
          type: "issue",
          productId: product,
          locationId: source,
          quantity: quantity("piece", 1000n),
        });
        await tx.appendIssue(
          issue,
          applyInventoryMovement(await tx.readBalance(product, source), issue),
        );
        return tx.persistSale(
          priced.sale,
          { ...input, ...(forgedPromotion ? { discounts: {} } : {}) },
          "raw security probe",
          details,
        );
      });
    }
    it("raw runtime SQL cannot bypass the cashier cap", async () => {
      await expect(rawSale(outsiderUser)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      expect(await stock()).toBe(10000n);
    });
    it("raw runtime SQL cannot label an arbitrary reduction as an approved promotion", async () => {
      await expect(rawSale(ownerUser, true)).rejects.toThrow();
      expect(await stock()).toBe(10000n);
    });
    it("rejects discounted children even after constraints are made immediate", async () => {
      const id = randomUUID(),
        movement = randomUUID();
      await expect(
        sql(tenantA, async (c) => {
          await c.query(
            "INSERT INTO retail.sales(id,tenant_id,location_id,status,total_minor_units,created_by,command_payload,shift_id) VALUES($1,$2,$3,'completed',100,$4,'{}',$5)",
            [id, tenantA, source, ownerUser, shiftId],
          );
          await c.query(
            "SET CONSTRAINTS retail.sale_discount_complete,retail.sale_line_discount_complete IMMEDIATE",
          );
          await c.query(
            "INSERT INTO retail.inventory_commands(id,tenant_id,kind) VALUES($1,$2,'issue')",
            [movement, tenantA],
          );
          await c.query(
            "INSERT INTO retail.inventory_movements(id,tenant_id,product_id,location_id,type,unit,amount,balance_after,sale_id) VALUES($1,$2,$3,$4,'issue','piece',1000,9000,$5)",
            [movement, tenantA, product, source, id],
          );
          await c.query(
            "INSERT INTO retail.sale_lines(tenant_id,sale_id,product_id,ordinal,sku,product_name,unit,quantity_milli_units,unit_price_minor_units,line_total_minor_units,movement_id,discount_minor_units) VALUES($1,$2,$3,0,'SKU-1','Producto','piece',1000,2000,100,$4,1900)",
            [tenantA, id, product, movement],
          );
        }),
      ).rejects.toMatchObject({
        code: "23514",
        message: "Legacy discount forbidden",
      });
      expect(await stock()).toBe(10000n);
    });
    it("rejects absent or numeric descriptive discount values in raw SQL snapshots", async () => {
      for (const malformed of ["absent", "number"]) {
        const id = randomUUID(),
          movement = randomUUID();
        const priced = priceDiscountedSale(command().draft, {
          sale: discount("amount", 0n),
        });
        const details = {
          ...priced.details!,
          lines: priced.details!.lines.map((l) => ({ ...l })),
        };
        const line = details.lines[0]!;
        if (malformed === "absent") Reflect.deleteProperty(line, "type");
        else Reflect.set(line, "value", 0);
        await expect(
          sql(tenantA, async (c) => {
            await c.query(
              "INSERT INTO retail.sales(id,tenant_id,location_id,status,total_minor_units,created_by,command_payload,shift_id,pricing_version,discount_intent,discount_details) VALUES($1,$2,$3,'completed',2000,$4,'{}',$5,1,$6,$7)",
              [
                id,
                tenantA,
                source,
                ownerUser,
                shiftId,
                JSON.stringify({ sale: { type: "amount", value: "0" } }),
                JSON.stringify(details),
              ],
            );
            await c.query(
              "INSERT INTO retail.inventory_commands(id,tenant_id,kind) VALUES($1,$2,'issue')",
              [movement, tenantA],
            );
            await c.query(
              "INSERT INTO retail.inventory_movements(id,tenant_id,product_id,location_id,type,unit,amount,balance_after,sale_id) VALUES($1,$2,$3,$4,'issue','piece',1000,9000,$5)",
              [movement, tenantA, product, source, id],
            );
            await c.query(
              "INSERT INTO retail.sale_lines(tenant_id,sale_id,product_id,ordinal,sku,product_name,unit,quantity_milli_units,unit_price_minor_units,line_total_minor_units,movement_id) VALUES($1,$2,$3,0,'SKU-1','Producto','piece',1000,2000,2000,$4)",
              [tenantA, id, product, movement],
            );
            await c.query(
              "SET CONSTRAINTS retail.sale_discount_complete IMMEDIATE",
            );
          }),
        ).rejects.toMatchObject({
          code: "23514",
          message: "Invalid line snapshot",
        });
        expect(await stock()).toBe(10000n);
      }
    });
    it("denies coupon redemption under snapshot isolation instead of accepting a stale usage count", async () => {
      const c = couponInput();
      await catalog().saveCoupon(c);
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await client.query(
          "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
          [ownerUser, tenantA],
        );
        await expect(
          client.query(
            "INSERT INTO retail.coupon_redemptions(tenant_id,coupon_id,sale_id) VALUES($1,$2,$3)",
            [tenantA, c.id, randomUUID()],
          ),
        ).rejects.toMatchObject({
          code: "42501",
          message: "Coupon redemption requires read committed",
        });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      expect((await catalog().listCoupons())[0]?.uses).toBe("0");
    });
    it("serializes the last coupon use across different branches and role scopes", async () => {
      const c = couponInput("1000", "1");
      await catalog().saveCoupon(c);
      const destShift = randomUUID();
      await new PostgresCash(pool, {
        tenantId: tenantA,
        userId: ownerUser,
      }).openShift({
        id: destShift,
        locationId: destination,
        openingCash: money(0n),
      });
      await receiveInventory(db, { ...receipt(), locationId: destination });
      const results = await Promise.allSettled([
        sell(command(1800n, { couponCode: c.code }), outsiderUser),
        sell(command(1800n, { couponCode: c.code }, destination, destShift)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect((await catalog().listCoupons())[0]?.uses).toBe("1");
    });
    it("rejects expired coupons and leaves balances unchanged", async () => {
      const c = { ...couponInput(), endsAt: "2000-01-01T00:00:00Z" };
      await catalog().saveCoupon(c);
      await expect(
        sell(command(1800n, { couponCode: c.code })),
      ).rejects.toBeInstanceOf(DiscountUnavailableError);
      expect(await stock()).toBe(10000n);
    });
    it("rejects a coupon expired between quote and checkout", async () => {
      const c = couponInput();
      await catalog().saveCoupon(c);
      const input = command(1800n, { couponCode: c.code });
      expect((await saleRepo().quoteSale(input)).sale.total.minorUnits).toBe(
        1800n,
      );
      await catalog().saveCoupon(
        { ...c, endsAt: "2000-01-01T00:00:00Z" },
        true,
      );
      await expect(sell(input)).rejects.toBeInstanceOf(
        DiscountUnavailableError,
      );
      expect(await stock()).toBe(10000n);
    });
    it("replays after catalog deactivation without consuming another coupon use", async () => {
      const c = couponInput();
      await catalog().saveCoupon(c);
      const input = command(1800n, { couponCode: c.code });
      const first = await sell(input);
      await catalog().saveCoupon({ ...c, active: false }, true);
      const retry = await sell(input);
      expect(retry.replayed).toBe(true);
      expect(retry.recorded).toEqual(first.recorded);
      expect((await catalog().listCoupons())[0]?.uses).toBe("1");
      expect(await stock()).toBe(9000n);
    });
    it("conflicts when the same SaleId carries a different discount with the same total", async () => {
      const input = command(1800n, { sale: discount("amount", 200n) });
      await sell(input);
      await expect(
        sell({ ...input, discounts: { sale: discount("percentage", 1000n) } }),
      ).rejects.toBeInstanceOf(SaleIdempotencyConflictError);
      expect(await stock()).toBe(9000n);
    });
    it("requires an updated quote when an automatic promotion is disabled", async () => {
      const p = promoInput();
      await catalog().savePromotion(p);
      const input = command(1800n);
      expect((await saleRepo().quoteSale(input)).sale.total.minorUnits).toBe(
        1800n,
      );
      await catalog().savePromotion({ ...p, active: false }, true);
      await expect(sell(input)).rejects.toBeInstanceOf(SaleQuoteChangedError);
      expect(await stock()).toBe(10000n);
    });
    it("rollback after redemption restores usage and ledger atomically", async () => {
      const c = couponInput("1000", "1");
      await catalog().saveCoupon(c);
      const input = command(1800n, { couponCode: c.code }),
        real = saleRepo();
      const failing = {
        readSale: real.readSale.bind(real),
        runSale: <T>(
          id: string,
          work: (
            tx: import("@smartretail/application").SaleTransaction,
          ) => Promise<T>,
        ) =>
          real.runSale(id, (tx) =>
            work({
              ...tx,
              persistSale: async (...args) => {
                await tx.persistSale(...args);
                throw new Error("Injected post-redemption rollback");
              },
            }),
          ),
      };
      await expect(completeSaleTransaction(failing, input)).rejects.toThrow(
        "Injected",
      );
      expect((await catalog().listCoupons())[0]?.uses).toBe("0");
      expect(await stock()).toBe(10000n);
      await sell(input);
      expect((await catalog().listCoupons())[0]?.uses).toBe("1");
    });
    it("forbids appending a coupon use to historical sales", async () => {
      const c = couponInput();
      await catalog().saveCoupon(c);
      const result = await sell(command());
      await expect(
        sql(tenantA, (client) =>
          client.query(
            "INSERT INTO retail.coupon_redemptions(tenant_id,coupon_id,sale_id) VALUES($1,$2,$3)",
            [tenantA, c.id, result.recorded.sale.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514", message: "Closed coupon sale" });
      expect((await catalog().listCoupons())[0]?.uses).toBe("0");
    });
    it("returns discounted paid amounts cumulatively and ignores edited promotions", async () => {
      const p = promoInput("2500");
      await catalog().savePromotion(p);
      const sold = await sell(
        command(4500n, undefined, source, shiftId, 3000n),
      );
      await catalog().savePromotion({ ...p, active: false }, true);
      const repo = new PostgresSaleReturns(pool, {
          tenantId: tenantA,
          userId: ownerUser,
        }),
        make = (amount: bigint, total: bigint) => ({
          id: randomUUID(),
          lines: [
            {
              saleLineId: product,
              productId: product,
              quantity: quantity("piece", amount),
              movementId: randomUUID(),
            },
          ],
          refunds: [{ method: "card" as const, amount: money(total) }],
        });
      const a = await repo.returnSale(
        sold.recorded.sale.id,
        make(1000n, 1500n),
      );
      const b = await repo.returnSale(
        sold.recorded.sale.id,
        make(2000n, 3000n),
      );
      expect(a.record.total.minorUnits + b.record.total.minorUnits).toBe(4500n);
      expect(await stock()).toBe(10000n);
    });
    it("supports zero-paid returns while guarding redemption privacy and runtime roles", async () => {
      const result = await sell(
        command(0n, { sale: discount("percentage", 10000n) }),
      );
      const r = await new PostgresSaleReturns(pool, {
        tenantId: tenantA,
        userId: ownerUser,
      }).returnSale(result.recorded.sale.id, {
        id: randomUUID(),
        lines: [
          {
            saleLineId: product,
            productId: product,
            quantity: quantity("piece", 1000n),
            movementId: randomUUID(),
          },
        ],
        refunds: [],
      });
      expect(r.record.total.minorUnits).toBe(0n);
      await expect(
        sql(tenantA, (c) => c.query("SELECT * FROM retail.coupon_redemptions")),
      ).rejects.toThrow();
      const roles = (
        await admin.query(
          "SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='smartretail_discounts_guard'",
        )
      ).rows[0];
      expect(roles).toEqual({
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
      });
    });
  });
  describe("TASK031 platform administration", () => {
    const platform = () => new PostgresPlatform(apiPool, outsiderUser);
    const command = () => ({
      id: randomUUID(),
      displayName: "SMOKE company",
      ownerUserId: adminUser,
    });
    beforeEach(async () => {
      await admin.query(
        "INSERT INTO auth.users(id,email) VALUES($1,'owner@example.test'),($2,'admin@example.test'),($3,'platform@example.test') ON CONFLICT(id) DO NOTHING",
        [ownerUser, adminUser, outsiderUser],
      );
      await admin.query(
        "INSERT INTO retail.platform_admins(user_id) VALUES($1)",
        [outsiderUser],
      );
    });
    it("platform privilege is separate from tenant owner and normal roles", async () => {
      expect(await platform().access()).toBe(true);
      for (const u of [ownerUser, adminUser, clerkUser])
        expect(await new PostgresPlatform(apiPool, u).access()).toBe(false);
    });
    it("normal owner cannot enumerate companies or Auth identities", async () => {
      const owner = new PostgresPlatform(apiPool, ownerUser);
      await expect(owner.list()).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(owner.users()).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("lists tenant metadata and correct totals without granting commercial access", async () => {
      const r = await platform().list();
      expect(r.summary).toEqual({ total: 2, active: 2, suspended: 0 });
      expect(r.companies).toHaveLength(2);
      await expect(
        new PostgresInventory(apiPool, {
          userId: outsiderUser,
          tenantId: tenantA,
        }).listProducts(),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("returns only company profile, members and branches in detail", async () => {
      const r = await platform().detail(tenantA);
      expect(r.members).toHaveLength(3);
      expect(r.branches).toHaveLength(2);
      expect(r).not.toHaveProperty("sales");
      expect(r).not.toHaveProperty("products");
    });
    it("creates company owner and initial profile atomically with two audit events", async () => {
      const c = command(),
        correlation = randomUUID();
      await platform().create(c, correlation);
      expect((await platform().detail(c.id)).members).toEqual([
        { name: "Propietario", role: "owner", status: "active" },
      ]);
      expect((await platform().detail(c.id)).profile?.businessName).toBe(
        c.displayName,
      );
      const a = (
        await admin.query(
          "SELECT action,user_id,correlation_id FROM retail.platform_audit WHERE tenant_id=$1 ORDER BY action",
          [c.id],
        )
      ).rows;
      expect(a).toEqual([
        {
          action: "company.created",
          user_id: outsiderUser,
          correlation_id: correlation,
        },
        {
          action: "owner.assigned",
          user_id: outsiderUser,
          correlation_id: correlation,
        },
      ]);
    });
    it("rejects nonexistent Auth owner without partial tenant or audit", async () => {
      const c = { ...command(), ownerUserId: randomUUID() };
      await expect(platform().create(c, randomUUID())).rejects.toThrow();
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.tenants WHERE tenant_id=$1",
            [c.id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (await admin.query("SELECT count(*)::int n FROM retail.platform_audit"))
          .rows[0].n,
      ).toBe(0);
    });
    it("retries same creation once and rejects changed owner or name", async () => {
      const c = command();
      await platform().create(c, randomUUID());
      await platform().create(c, randomUUID());
      expect(
        (await admin.query("SELECT count(*)::int n FROM retail.platform_audit"))
          .rows[0].n,
      ).toBe(2);
      await expect(
        platform().create({ ...c, ownerUserId: ownerUser }, randomUUID()),
      ).rejects.toThrow();
      await expect(
        platform().create({ ...c, displayName: "Different" }, randomUUID()),
      ).rejects.toThrow();
    });
    it("a replayed reactivation cannot undo a later suspension", async () => {
      await platform().changeStatus(tenantA, "suspended", randomUUID());
      const command = randomUUID();
      await platform().changeStatus(tenantA, "active", randomUUID(), command);
      await platform().changeStatus(tenantA, "suspended", randomUUID());
      await platform().changeStatus(tenantA, "active", randomUUID(), command);
      expect((await platform().detail(tenantA)).status).toBe("suspended");
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.platform_audit WHERE command_id=$1",
            [command],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("a no-op command is durable and cannot reactivate on delayed replay", async () => {
      const command = randomUUID();
      await platform().changeStatus(tenantA, "active", randomUUID(), command);
      await platform().changeStatus(tenantA, "suspended", randomUUID());
      await platform().changeStatus(tenantA, "active", randomUUID(), command);
      expect((await platform().detail(tenantA)).status).toBe("suspended");
      expect(
        (
          await admin.query(
            "SELECT metadata->>'changed' changed FROM retail.platform_audit WHERE command_id=$1",
            [command],
          )
        ).rows[0].changed,
      ).toBe("false");
    });
    it("rejects changed status or tenant for an existing command identity", async () => {
      const command = randomUUID();
      await platform().changeStatus(
        tenantA,
        "suspended",
        randomUUID(),
        command,
      );
      await expect(
        platform().changeStatus(tenantA, "active", randomUUID(), command),
      ).rejects.toThrow();
      await expect(
        platform().changeStatus(tenantB, "suspended", randomUUID(), command),
      ).rejects.toThrow();
      expect((await platform().detail(tenantB)).status).toBe("active");
    });
    it("direct SQL cash lock, pending suspension and adapter lock have one ordering", async () => {
      const direct = await pool.connect(),
        operation = await pool.connect();
      try {
        for (const c of [direct, operation]) {
          await c.query("BEGIN");
          await c.query("SET LOCAL statement_timeout='5s'");
          await c.query(
            "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
            [tenantA, ownerUser],
          );
        }
        await direct.query("SELECT retail.lock_cash_shift($1)", [shiftId]);
        const suspension = platform().changeStatus(
          tenantA,
          "suspended",
          randomUUID(),
        );
        const waitForBlocked = async (pid?: number) => {
          for (let n = 0; n < 100; n++) {
            const q = await admin.query(
              "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0 AND ($1::int IS NULL OR pid=$1)",
              [pid ?? null],
            );
            if (q.rows[0].n > 0) return;
            await new Promise((r) => setTimeout(r, 10));
          }
          throw Error("Expected blocking not observed");
        };
        await waitForBlocked();
        const pid = (await operation.query("SELECT pg_backend_pid() pid"))
          .rows[0].pid;
        const blocked = operation.query(
          "SELECT retail.lock_membership(),retail.lock_cash_shift($1)",
          [shiftId],
        );
        const result = blocked.then(
          async () => {
            await operation.query("COMMIT");
            return { code: "completed" };
          },
          async (e: unknown) => {
            await operation.query("ROLLBACK");
            return e;
          },
        );
        await waitForBlocked(pid);
        await direct.query("COMMIT");
        await suspension;
        expect(await result).toEqual(
          expect.objectContaining({
            code: expect.stringMatching(/^(completed|42501)$/),
          }),
        );
        expect((await platform().detail(tenantA)).status).toBe("suspended");
      } finally {
        await direct.query("ROLLBACK");
        await operation.query("ROLLBACK");
        direct.release();
        operation.release();
      }
    });
    it("suspends and reactivates idempotently with durable audit", async () => {
      const commandId = randomUUID();
      await platform().changeStatus(
        tenantA,
        "suspended",
        randomUUID(),
        commandId,
      );
      await platform().changeStatus(
        tenantA,
        "suspended",
        randomUUID(),
        commandId,
      );
      expect((await platform().list()).summary).toEqual({
        total: 2,
        active: 1,
        suspended: 1,
      });
      await platform().changeStatus(tenantA, "active", randomUUID());
      expect(
        (
          await admin.query(
            "SELECT action FROM retail.platform_audit ORDER BY created_at",
          )
        ).rows.map((r) => r.action),
      ).toEqual(["company.suspended", "company.reactivated"]);
    });
    it("blocks reads and writes of a suspended company's ordinary owner", async () => {
      await platform().changeStatus(tenantA, "suspended", randomUUID());
      await expect(db.listProducts()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(
        db.createProduct(
          fixtureProduct(productId(randomUUID()), "SUSPENDED", null),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        new PostgresBusiness(apiPool, {
          userId: ownerUser,
          tenantId: tenantA,
        }).read(),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("preserves stock, cash and product history and restores normal access", async () => {
      const counts = async () =>
        (
          await admin.query(
            "SELECT (SELECT count(*) FROM retail.inventory_movements)::int movements,(SELECT count(*) FROM retail.cash_register_shifts)::int shifts,(SELECT count(*) FROM retail.products)::int products",
          )
        ).rows[0];
      const before = await counts();
      await platform().changeStatus(tenantA, "suspended", randomUUID());
      expect(await counts()).toEqual(before);
      await platform().changeStatus(tenantA, "active", randomUUID());
      expect(await stock()).toBe(10000n);
      expect(await db.listProducts()).toHaveLength(1);
    });
    it("discovery returns only own memberships and reports suspension explicitly", async () => {
      await platform().changeStatus(tenantA, "suspended", randomUUID());
      const rows = await listTenantMemberships(apiPool, clerkUser);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tenantId: tenantA,
        tenantStatus: "suspended",
      });
      expect(await listTenantMemberships(apiPool, outsiderUser)).toEqual([]);
    });
    it("tenant A cannot query tenant B by forged tenant context", async () => {
      await expect(
        new PostgresBusiness(apiPool, {
          userId: clerkUser,
          tenantId: tenantB,
        }).read(),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      expect(
        await new PostgresPlatform(apiPool, clerkUser).tenantStatus(tenantB),
      ).toBeUndefined();
    });
    it("normal SQL cannot grant platform privileges, change status, delete company or write audit", async () => {
      for (const statement of [
        "INSERT INTO retail.platform_admins(user_id) VALUES('550e8400-e29b-41d4-a716-446655440020')",
        "UPDATE retail.tenants SET status='suspended'",
        "DELETE FROM retail.tenants",
        "INSERT INTO retail.platform_audit(tenant_id,user_id,action,correlation_id,metadata) VALUES('550e8400-e29b-41d4-a716-446655440001','550e8400-e29b-41d4-a716-446655440020','company.created',gen_random_uuid(),'{}')",
        "TRUNCATE retail.platform_audit",
      ])
        await expect(
          sql(tenantA, (c) => c.query(statement)),
        ).rejects.toMatchObject({ code: "42501" });
    });
    it("audit cannot be updated or deleted even by platform runtime", async () => {
      await platform().changeStatus(tenantA, "suspended", randomUUID());
      for (const s of [
        "UPDATE retail.platform_audit SET metadata='{}'",
        "DELETE FROM retail.platform_audit",
      ])
        await expect(
          sql(tenantA, (c) => c.query(s), outsiderUser),
        ).rejects.toMatchObject({ code: "42501" });
    });
    it("Auth directory exposes only id/email and runtime cannot query auth.users directly", async () => {
      const users = await platform().users("admin@example");
      expect(users).toEqual([{ id: adminUser, email: "admin@example.test" }]);
      await expect(
        sql(tenantA, (c) => c.query("SELECT id,email FROM auth.users")),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        sql(
          tenantA,
          (c) => c.query("SELECT * FROM retail.platform_existing_auth_users()"),
          outsiderUser,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      const guard = await admin.connect();
      try {
        await guard.query("BEGIN");
        await guard.query("SET LOCAL ROLE smartretail_platform_guard");
        await guard.query("SELECT set_config('app.user_id',$1,true)", [
          ownerUser,
        ]);
        expect(
          (
            await guard.query(
              "SELECT * FROM retail.platform_existing_auth_users()",
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await guard.query(
              "SELECT has_schema_privilege(current_user,'auth','USAGE') allowed",
            )
          ).rows[0].allowed,
        ).toBe(false);
      } finally {
        await guard.query("ROLLBACK");
        guard.release();
      }
    });
    it("inactive platform administrator cannot access or mutate platform", async () => {
      await admin.query(
        "UPDATE retail.platform_admins SET active=false WHERE user_id=$1",
        [outsiderUser],
      );
      expect(await platform().access()).toBe(false);
      await expect(
        platform().changeStatus(tenantA, "suspended", randomUUID()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("unknown company and invalid pagination fail without changes", async () => {
      await expect(platform().detail(randomUUID())).rejects.toThrow();
      await expect(
        platform().changeStatus(randomUUID(), "suspended", randomUUID()),
      ).rejects.toThrow();
      await expect(platform().list(0)).rejects.toThrow();
      await expect(platform().users("", 0)).rejects.toThrow();
    });
    it("direct runtime writes are blocked after suspension even outside the adapter", async () => {
      await platform().changeStatus(tenantA, "suspended", randomUUID());
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "INSERT INTO retail.products(tenant_id,id,name,sku,unit,currency,purchase_cost,sale_price,status) VALUES($1,$2,'Denied','DENIED','piece','MXN',0,0,'active')",
            [tenantA, randomUUID()],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      expect(
        (await sql(tenantA, (c) => c.query("SELECT * FROM retail.products")))
          .rowCount,
      ).toBe(0);
    });
    async function waiting(blocker: number) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const r = await admin.query<{ waiting: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))) waiting",
          [blocker],
        );
        if (r.rows[0]!.waiting) return true;
        await new Promise((r) => setTimeout(r, 25));
      }
      return false;
    }
    it("suspension waits for an authorized operation transaction to finish", async () => {
      const c = await pool.connect();
      let pending: Promise<unknown> | undefined;
      try {
        await c.query("BEGIN");
        await c.query(
          "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
          [ownerUser, tenantA],
        );
        await c.query("SELECT retail.lock_membership()");
        const pid = (await c.query("SELECT pg_backend_pid() pid")).rows[0].pid;
        let done = false;
        pending = platform()
          .changeStatus(tenantA, "suspended", randomUUID())
          .finally(() => {
            done = true;
          });
        expect(await waiting(pid)).toBe(true);
        expect(done).toBe(false);
        await c.query("COMMIT");
        await pending;
        expect((await platform().detail(tenantA)).status).toBe("suspended");
      } finally {
        await c.query("ROLLBACK");
        c.release();
        if (pending) await pending;
      }
    });
    it("an operation waiting on suspension rechecks committed tenant state", async () => {
      const c = await pool.connect();
      let pending: Promise<boolean> | undefined;
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.user_id',$1,true)", [
          outsiderUser,
        ]);
        await c.query(
          "SELECT retail.platform_company_status($1,'suspended',$2,$2)",
          [tenantA, randomUUID()],
        );
        const pid = (await c.query("SELECT pg_backend_pid() pid")).rows[0].pid;
        let done = false;
        pending = db
          .createProduct(fixtureProduct(productId(randomUUID()), "WAIT", null))
          .then(
            () => true,
            () => false,
          )
          .finally(() => {
            done = true;
          });
        expect(await waiting(pid)).toBe(true);
        expect(done).toBe(false);
        await c.query("COMMIT");
        expect(await pending).toBe(false);
      } finally {
        await c.query("ROLLBACK");
        c.release();
        if (pending) await pending;
      }
    });
  });

  describe("TASK030 business and branch settings", () => {
    const repo = (userId = ownerUser, tenantId = tenantA) =>
      new PostgresBusiness(apiPool, { userId, tenantId });
    const profile = {
      ...defaultBusinessProfile,
      businessName: "Business A",
      tradeName: "Tienda",
      phone: "5551234567",
      email: "shop@example.test",
      website: "https://example.test",
      ticketFooter: "Gracias",
    };
    const branch = {
      displayName: "Sucursal central",
      address: "Calle 1",
      phone: "5551112222",
      receiptHeader: "Bienvenido",
      status: "active" as const,
    };
    const checkout = (): SaleCheckoutInput => {
      const draft = addSaleProduct(
        createSaleDraft(randomUUID()),
        fixtureProduct(),
        quantity("piece", 1000n),
      );
      return {
        draft,
        locationId: source,
        shiftId,
        payments: [{ method: "card", amount: draft.total }],
        movements: [{ productId: product, movementId: randomUUID() }],
      };
    };
    it("returns explicit operational defaults without inserting on read", async () => {
      expect((await repo().read()).profile).toEqual(defaultBusinessProfile);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.business_profiles",
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("upserts one profile per tenant and preserves tenant isolation", async () => {
      await repo().save(profile, randomUUID());
      await repo().save({ ...profile, tradeName: "Actualizado" }, randomUUID());
      expect((await repo().read()).profile.tradeName).toBe("Actualizado");
      expect((await repo(ownerUser, tenantB).read()).profile).toEqual(
        defaultBusinessProfile,
      );
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.business_profiles",
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("allows admin and denies clerk, inactive member and outsider writes", async () => {
      await repo(adminUser).save(profile, randomUUID());
      for (const user of [clerkUser, outsiderUser])
        await expect(
          repo(user).save(profile, randomUUID()),
        ).rejects.toBeInstanceOf(PermissionDeniedError);
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND user_id=$2",
        [tenantA, adminUser],
      );
      await expect(repo(adminUser).read()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
    it("lets an assigned clerk read identity but not manage settings", async () => {
      await repo().save(profile, randomUUID());
      const r = await repo(clerkUser).read();
      expect(r.profile.businessName).toBe(profile.businessName);
      expect(r.branches).toHaveLength(2);
      await expect(
        repo(clerkUser).saveBranch(source, branch, randomUUID()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("changes branch presentation without changing code, identity or stock", async () => {
      const before = (await repo().read()).branches.find(
        (b) => b.id === source,
      )!;
      await repo().saveBranch(source, branch, randomUUID());
      const after = (await repo().read()).branches.find(
        (b) => b.id === source,
      )!;
      expect(after).toMatchObject({
        ...branch,
        id: before.id,
        name: before.name,
        code: before.code,
      });
      expect(await stock()).toBe(10000n);
      expect(
        (await db.listLocations()).find((b) => b.id === source)?.name,
      ).toBe(branch.displayName);
    });
    it("rejects missing and foreign branch references", async () => {
      await expect(
        repo().saveBranch(randomUUID(), branch, randomUUID()),
      ).rejects.toBeInstanceOf(BusinessSettingsNotFoundError);
      const foreign = randomUUID();
      await other.createLocation(
        createInventoryLocation({
          id: inventoryLocationId(foreign),
          name: inventoryLocationName("Other"),
          code: inventoryLocationCode("OTHER"),
          status: "active",
        }),
      );
      await expect(
        repo().saveBranch(foreign, branch, randomUUID()),
      ).rejects.toBeInstanceOf(BusinessSettingsNotFoundError);
    });
    it("enforces direct SQL RLS and fixed currency constraints", async () => {
      await expect(
        sql(
          tenantA,
          (c) =>
            c.query(
              "INSERT INTO retail.business_profiles(tenant_id,business_name) VALUES($1,'Denied')",
              [tenantA],
            ),
          clerkUser,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        sql(tenantA, async (c) => {
          await c.query("SELECT set_config('app.correlation_id',$1,true)", [
            randomUUID(),
          ]);
          await c.query(
            "INSERT INTO retail.business_profiles(tenant_id,business_name,currency) VALUES($1,'Bad','USD')",
            [tenantA],
          );
        }),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        (await admin.query("SELECT count(*)::int n FROM retail.settings_audit"))
          .rows[0].n,
      ).toBe(0);
    });
    it("audits actor and correlation with field names only and rejects direct ledger writes", async () => {
      const correlation = randomUUID();
      await repo().save(profile, correlation);
      await repo().save(profile, randomUUID());
      const rows = (await admin.query("SELECT * FROM retail.settings_audit"))
        .rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_user_id: ownerUser,
        tenant_id: tenantA,
        correlation_id: correlation,
        operation: "business.settings",
      });
      expect(rows[0].fields).toContain("phone");
      expect(JSON.stringify(rows[0].fields)).not.toContain(profile.phone);
      await expect(
        sql(tenantA, (c) => c.query("DELETE FROM retail.settings_audit")),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        sql(tenantA, (c) =>
          c.query(
            "INSERT INTO retail.settings_audit(tenant_id,actor_user_id,operation,entity_id,correlation_id,fields) VALUES($1,$2,'business.settings',$1,$3,'[]')",
            [tenantA, ownerUser, randomUUID()],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("keeps completed sale and cash history after deactivation", async () => {
      const sales = new PostgresSales(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      });
      const input = checkout();
      await completeSaleTransaction(sales, input);
      await repo().saveBranch(
        source,
        { ...branch, status: "inactive" },
        randomUUID(),
      );
      expect((await sales.readSale(input.draft.id)).sale.total.minorUnits).toBe(
        2000n,
      );
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.cash_register_shifts WHERE id=$1",
            [shiftId],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("rejects new sales and shifts at inactive branches without moving stock", async () => {
      await repo().saveBranch(
        source,
        { ...branch, status: "inactive" },
        randomUUID(),
      );
      await expect(
        completeSaleTransaction(
          new PostgresSales(apiPool, { userId: ownerUser, tenantId: tenantA }),
          checkout(),
        ),
      ).rejects.toThrow();
      await expect(
        new PostgresCash(apiPool, {
          userId: ownerUser,
          tenantId: tenantA,
        }).openShift({
          id: randomUUID(),
          locationId: source,
          openingCash: money(0n),
        }),
      ).rejects.toThrow();
      expect(await stock()).toBe(10000n);
      expect(
        (await admin.query("SELECT count(*)::int n FROM retail.sales")).rows[0]
          .n,
      ).toBe(0);
    });
    it("rejects new purchases and receipts after deactivation and preserves ordered history", async () => {
      const purchases = new PostgresPurchasing(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      });
      const supplier = await purchases.createSupplier(randomUUID(), {
        name: "Supplier",
        status: "active",
      });
      const input = {
        id: randomUUID(),
        supplierId: supplier.id,
        locationId: source,
        lines: [
          {
            productId: product,
            quantityOrdered: quantity("piece", 1000n),
            unitCost: money(100n),
          },
        ],
      };
      await purchases.createPurchase(input);
      await purchases.changePurchase(input.id, "order");
      await repo().saveBranch(
        source,
        { ...branch, status: "inactive" },
        randomUUID(),
      );
      await expect(
        purchases.createPurchase({ ...input, id: randomUUID() }),
      ).rejects.toThrow();
      await expect(
        purchases.receivePurchaseOrder(input.id, {
          id: randomUUID(),
          lines: [{ productId: product, quantity: quantity("piece", 1000n) }],
        }),
      ).rejects.toThrow();
      expect((await purchases.readPurchase(input.id)).status).toBe("ordered");
      expect(await stock()).toBe(10000n);
    });
    it("uses configured timezone and branch/business report context without changing totals", async () => {
      await repo().save(
        { ...profile, timezone: "America/Tijuana" },
        randomUUID(),
      );
      await repo().saveBranch(source, branch, randomUUID());
      const report = await new PostgresReporting(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      }).operationalReport({
        ...reportPeriod("today", new Date(), "America/Tijuana"),
        locationId: source,
      });
      expect(report.timezone).toBe("America/Tijuana");
      expect(report.context).toMatchObject({
        businessName: "Tienda",
        branchName: branch.displayName,
        currency: "MXN",
      });
      expect(report.sales.gross).toBe("0");
    });
  });

  describe("TASK030 branch serialization", () => {
    it("waits for deactivation to commit before allowing a new shift", async () => {
      const c = await admin.connect();
      let pending: Promise<boolean> | undefined;
      try {
        await c.query("BEGIN");
        await c.query(
          "UPDATE retail.inventory_locations SET status='inactive' WHERE tenant_id=$1 AND id=$2",
          [tenantA, destination],
        );
        const blocker = (
          await c.query<{ pid: number }>("SELECT pg_backend_pid() pid")
        ).rows[0]!.pid;
        let settled = false;
        pending = new PostgresCash(apiPool, {
          userId: ownerUser,
          tenantId: tenantA,
        })
          .openShift({
            id: randomUUID(),
            locationId: destination,
            openingCash: money(0n),
          })
          .then(
            () => true,
            () => false,
          )
          .finally(() => {
            settled = true;
          });
        let waiting = false;
        const deadline = Date.now() + 5000;
        while (!waiting && Date.now() < deadline) {
          waiting = (
            await admin.query<{ waiting: boolean }>(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='smartretail_api' AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))) waiting",
              [blocker],
            )
          ).rows[0]!.waiting;
          if (!waiting) await new Promise((r) => setTimeout(r, 25));
        }
        expect(waiting).toBe(true);
        expect(settled).toBe(false);
        await c.query("COMMIT");
        expect(await pending).toBe(false);
        expect(
          (
            await admin.query(
              "SELECT count(*)::int n FROM retail.cash_register_shifts WHERE location_id=$1",
              [destination],
            )
          ).rows[0].n,
        ).toBe(0);
      } finally {
        await c.query("ROLLBACK");
        c.release();
        if (pending) await pending;
      }
    });
  });

  describe("TASK029 payables and expenses", () => {
    const financial = (userId = ownerUser, tenantId = tenantA) =>
      new PostgresPayables(apiPool, { userId, tenantId });
    const buying = () =>
      new PostgresPurchasing(apiPool, { userId: ownerUser, tenantId: tenantA });
    const cash = () =>
      new PostgresCash(apiPool, { userId: ownerUser, tenantId: tenantA });
    async function order(receive = true, cost = 1000n) {
      const b = buying(),
        supplier = await b.createSupplier(randomUUID(), {
          name: "Supplier",
          status: "active",
        }),
        id = randomUUID();
      await b.createPurchase({
        id,
        supplierId: supplier.id,
        locationId: source,
        lines: [
          {
            productId: product,
            quantityOrdered: quantity("piece", 3000n),
            unitCost: money(cost),
          },
        ],
      });
      await b.changePurchase(id, "order");
      if (receive)
        await b.receivePurchaseOrder(id, {
          id: randomUUID(),
          lines: [{ productId: product, quantity: quantity("piece", 3000n) }],
        });
      return { id, supplier, b };
    }
    const payment = (amount = 1000n, id = randomUUID()) => ({
      id,
      method: "card" as const,
      amount: money(amount),
    });
    const expense = (
      method: "cash" | "card" | "bank" = "card",
      amount = 500n,
    ) => ({
      id: randomUUID(),
      category: "servicios" as const,
      description: "SMOKE expense",
      method,
      amount: money(amount),
      locationId: source,
      ...(method === "cash" ? { shiftId } : {}),
    });
    async function fund(amount = 5000n) {
      await cash().moveCash({
        id: randomUUID(),
        shiftId,
        type: "cash_in",
        amount: money(amount),
        reason: "SMOKE funding",
      });
    }
    async function ledger() {
      return (
        await admin.query("SELECT count(*)::int n FROM retail.payables_audit")
      ).rows[0].n;
    }
    it("creates exact open payable once from completed purchase", async () => {
      const o = await order();
      const d = await financial().read(o.id);
      expect(d.payable.originalAmount.minorUnits).toBe("3000");
      expect(d.payable.status).toBe("open");
      expect(await ledger()).toBe(1);
    });
    it("partial receipt defers payable until fully received and retry adds none", async () => {
      const o = await order(false);
      const part = {
        id: randomUUID(),
        lines: [{ productId: product, quantity: quantity("piece", 1000n) }],
      };
      await o.b.receivePurchaseOrder(o.id, part);
      expect(await financial().list()).toEqual([]);
      const last = {
        id: randomUUID(),
        lines: [{ productId: product, quantity: quantity("piece", 2000n) }],
      };
      await o.b.receivePurchaseOrder(o.id, last);
      await o.b.receivePurchaseOrder(o.id, last);
      expect(await financial().list()).toHaveLength(1);
    });
    it("zero-cost purchase has paid zero account", async () => {
      const o = await order(true, 0n);
      expect((await financial().read(o.id)).payable.status).toBe("paid");
    });
    it("partial card payment updates exact projection without cash", async () => {
      const o = await order();
      await financial().pay(o.id, payment(), randomUUID());
      const d = await financial().read(o.id);
      expect(d.payable.paidAmount.minorUnits).toBe("1000");
      expect(d.payable.outstandingAmount.minorUnits).toBe("2000");
      expect(d.payable.status).toBe("partially_paid");
      expect((await cash().currentShift(source))?.expectedCash.minorUnits).toBe(
        0n,
      );
      for (let i = 0; i < 101; i++)
        await financial().pay(o.id, payment(1n), randomUUID());
      const first = await financial().read(o.id);
      expect(first.payments).toHaveLength(100);
      const rest = await financial().read(o.id, first.payments.at(-1)!.id);
      expect(rest.payments).toHaveLength(2);
      expect(
        new Set([...first.payments, ...rest.payments].map((p) => p.id)).size,
      ).toBe(102);
      const supplierFirst = await financial().supplierSummary(o.supplier.id);
      const supplierRest = await financial().supplierSummary(
        o.supplier.id,
        supplierFirst.payments.at(-1)!.id,
      );
      expect(supplierRest.payments).toHaveLength(2);
    });
    it("full bank payment settles immediately", async () => {
      const o = await order();
      await financial().pay(
        o.id,
        { ...payment(3000n), method: "bank" },
        randomUUID(),
      );
      expect((await financial().read(o.id)).payable.status).toBe("paid");
    });
    it("overpayment leaves account payment audit unchanged", async () => {
      const o = await order();
      await expect(
        financial().pay(o.id, payment(3001n), randomUUID()),
      ).rejects.toThrow();
      expect((await financial().read(o.id)).payments).toEqual([]);
      expect(await ledger()).toBe(1);
    });
    it("same payment replay after paid does not duplicate", async () => {
      const o = await order(),
        p = payment(3000n);
      const concurrent = await Promise.all([
        financial().pay(o.id, p, randomUUID()),
        financial().pay(o.id, p, randomUUID()),
      ]);
      expect(concurrent.filter((r) => r.replayed)).toHaveLength(1);
      expect((await financial().pay(o.id, p, randomUUID())).replayed).toBe(
        true,
      );
      expect((await financial().read(o.id)).payments).toHaveLength(1);
      expect(await ledger()).toBe(2);
    });
    it("same payment changed payload conflicts", async () => {
      const o = await order(),
        p = payment();
      await financial().pay(o.id, p, randomUUID());
      await expect(
        financial().pay(o.id, { ...p, method: "bank" }, randomUUID()),
      ).rejects.toThrow();
      expect((await financial().read(o.id)).payments).toHaveLength(1);
    });
    it("concurrent payments serialize and prevent overpayment", async () => {
      const o = await order();
      const r = await Promise.allSettled([
        financial().pay(o.id, payment(2000n), randomUUID()),
        financial().pay(o.id, payment(2000n), randomUUID()),
      ]);
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(
        (await financial().read(o.id)).payable.outstandingAmount.minorUnits,
      ).toBe("1000");
      await fund(1500n);
      const cashRace = await Promise.allSettled([
        financial().pay(
          o.id,
          { ...payment(1000n), method: "cash", shiftId },
          randomUUID(),
        ),
        financial().createExpense(expense("cash", 1000n), randomUUID()),
      ]);
      expect(cashRace.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await cash().currentShift(source))?.expectedCash.minorUnits).toBe(
        500n,
      );
    });
    it("cash supplier payment creates one exact cash_out", async () => {
      const o = await order();
      await fund();
      const p = { ...payment(), method: "cash" as const, shiftId };
      await financial().pay(o.id, p, randomUUID());
      await financial().pay(o.id, p, randomUUID());
      expect((await cash().currentShift(source))?.expectedCash.minorUnits).toBe(
        4000n,
      );
      expect(
        (
          await admin.query(
            "SELECT count(*)::int n FROM retail.cash_movements WHERE payable_payment_id=$1",
            [p.id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("insufficient cash rolls back whole supplier payment", async () => {
      const o = await order();
      await expect(
        financial().pay(
          o.id,
          { ...payment(), method: "cash", shiftId },
          randomUUID(),
        ),
      ).rejects.toThrow();
      expect(
        (await financial().read(o.id)).payable.outstandingAmount.minorUnits,
      ).toBe("3000");
      expect(await ledger()).toBe(1);
    });
    it("cash shift from another location rejected", async () => {
      const o = await order();
      const foreign = randomUUID();
      await cash().openShift({
        id: foreign,
        locationId: destination,
        openingCash: money(5000n),
      });
      await expect(
        financial().pay(
          o.id,
          { ...payment(), method: "cash", shiftId: foreign },
          randomUUID(),
        ),
      ).rejects.toThrow();
      expect((await financial().read(o.id)).payments).toHaveLength(0);
    });
    it("inactive supplier preserves payable and permits settlement", async () => {
      const o = await order();
      const otherSupplier = await o.b.createSupplier(randomUUID(), {
        name: "Other supplier",
        status: "active",
      });
      async function draftBatch(supplier: string) {
        const ids = Array.from({ length: 100 }, () => randomUUID());
        await sql(tenantA, async (c) => {
          await c.query("SELECT set_config('app.correlation_id',$1,true)", [
            randomUUID(),
          ]);
          await c.query(
            "INSERT INTO retail.purchase_orders(id,tenant_id,supplier_id,location_id,created_by) SELECT id,$2,$3,$4,$5 FROM unnest($1::uuid[]) id",
            [ids, tenantA, supplier, source, ownerUser],
          );
          await c.query(
            "INSERT INTO retail.purchase_order_lines(tenant_id,purchase_id,product_id,unit,quantity_ordered,unit_cost) SELECT $2,id,$3,'piece',1000,1 FROM unnest($1::uuid[]) id",
            [ids, tenantA, product],
          );
        });
      }
      await draftBatch(otherSupplier.id);
      expect(
        (await financial().supplierSummary(o.supplier.id)).purchases,
      ).toHaveLength(1);
      await draftBatch(o.supplier.id);
      const history = await financial().supplierSummary(o.supplier.id);
      expect(history.purchases).toHaveLength(100);
      const older = await financial().supplierSummary(
        o.supplier.id,
        undefined,
        history.purchases.at(-1)!.id,
      );
      expect(older.purchases).toHaveLength(1);
      expect(older.purchases[0]?.id).toBe(o.id);
      await o.b.updateSupplier(o.supplier.id, { status: "inactive" });
      await financial().pay(o.id, payment(3000n), randomUUID());
      expect((await financial().list(o.supplier.id))[0]?.status).toBe("paid");
    });
    it("cross-tenant account and location are denied", async () => {
      const o = await order();
      await expect(
        financial(ownerUser, tenantB).pay(o.id, payment(), randomUUID()),
      ).rejects.toThrow();
      await expect(financial(ownerUser, tenantB).read(o.id)).rejects.toThrow();
      const unique = inventoryLocationId(randomUUID());
      await db.createLocation(
        createInventoryLocation({
          id: unique,
          code: inventoryLocationCode("ONLY-A"),
          name: inventoryLocationName("Only A"),
          status: "active",
        }),
      );
      await expect(
        financial(ownerUser, tenantB).createExpense(
          { ...expense(), locationId: unique },
          randomUUID(),
        ),
      ).rejects.toThrow();
    });
    it("clerk cannot see or write financial data", async () => {
      const o = await order();
      await expect(financial(clerkUser).list()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(
        financial(clerkUser).pay(o.id, payment(), randomUUID()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        financial(clerkUser).createExpense(expense(), randomUUID()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("inactive membership denied", async () => {
      await admin.query(
        "UPDATE retail.tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND user_id=$2",
        [tenantA, adminUser],
      );
      await expect(financial(adminUser).expenses()).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
    it("expense cash adds cash_out once with audit", async () => {
      await fund();
      const e = expense("cash");
      await financial().createExpense(e, randomUUID());
      expect((await financial().createExpense(e, randomUUID())).replayed).toBe(
        true,
      );
      expect((await cash().currentShift(source))?.expectedCash.minorUnits).toBe(
        4500n,
      );
      expect(await ledger()).toBe(1);
    });
    it("expense card and bank do not affect physical cash", async () => {
      await financial().createExpense(expense("card"), randomUUID());
      await financial().createExpense(expense("bank"), randomUUID());
      expect((await cash().currentShift(source))?.expectedCash.minorUnits).toBe(
        0n,
      );
      expect(await financial().expenses()).toHaveLength(2);
    });
    it("expense same ID different intent conflicts", async () => {
      const e = expense();
      await financial().createExpense(e, randomUUID());
      await expect(
        financial().createExpense(
          { ...e, description: "Changed" },
          randomUUID(),
        ),
      ).rejects.toThrow();
      expect(await ledger()).toBe(1);
    });
    it("expense insufficient cash leaves no ledger or expense", async () => {
      await expect(
        financial().createExpense(expense("cash"), randomUUID()),
      ).rejects.toThrow();
      expect(await financial().expenses()).toHaveLength(0);
      expect(await ledger()).toBe(0);
    });
    it("closed cash shift rejects new cash expense but replays prior", async () => {
      await fund();
      const e = expense("cash");
      await financial().createExpense(e, randomUUID());
      await cash().closeShift(shiftId, money(4500n));
      expect((await financial().createExpense(e, randomUUID())).replayed).toBe(
        true,
      );
      await expect(
        financial().createExpense(expense("cash"), randomUUID()),
      ).rejects.toThrow();
    });
    it("runtime cannot mutate financial ledger or grant its guard", async () => {
      await financial().createExpense(expense(), randomUUID());
      await expect(
        sql(tenantA, (c) =>
          c.query("UPDATE retail.expenses SET amount_minor_units=1"),
        ),
      ).rejects.toThrow();
      const roles = (
        await admin.query(
          "SELECT pg_has_role('smartretail_api','smartretail_payables_guard','MEMBER') AS member",
        )
      ).rows[0];
      expect(roles.member).toBe(false);
    });
    it("cashier reads assigned expenses but cannot pay or write", async () => {
      await admin.query(
        "UPDATE retail.tenant_memberships SET role='cashier' WHERE tenant_id=$1 AND user_id=$2",
        [tenantA, clerkUser],
      );
      await financial().createExpense(expense(), randomUUID());
      expect(await financial(clerkUser).expenses()).toHaveLength(1);
      await expect(
        financial(clerkUser).createExpense(expense(), randomUUID()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      const o = await order();
      await expect(
        financial(clerkUser).pay(o.id, payment(), randomUUID()),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    it("guard membership is rejected before financial write", async () => {
      await admin.query("GRANT smartretail_payables_guard TO smartretail_api");
      try {
        await expect(
          financial().createExpense(expense(), randomUUID()),
        ).rejects.toThrow("Unsafe database application role");
        expect(await ledger()).toBe(0);
      } finally {
        await admin.query(
          "REVOKE smartretail_payables_guard FROM smartretail_api",
        );
      }
    });
    it("audit failure rolls back expense and cash atomically", async () => {
      await fund();
      await admin.query(
        "CREATE FUNCTION retail.task029_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'simulated audit failure'; END$$; CREATE TRIGGER task029_fail_audit BEFORE INSERT ON retail.payables_audit FOR EACH ROW EXECUTE FUNCTION retail.task029_fail_audit()",
      );
      try {
        await expect(
          financial().createExpense(expense("cash"), randomUUID()),
        ).rejects.toThrow();
        expect(await financial().expenses()).toHaveLength(0);
        expect(
          (await cash().currentShift(source))?.expectedCash.minorUnits,
        ).toBe(5000n);
      } finally {
        await admin.query(
          "DROP TRIGGER task029_fail_audit ON retail.payables_audit;DROP FUNCTION retail.task029_fail_audit()",
        );
      }
    });
    it("reports split debt expenses payments and two cash_out sources", async () => {
      const o = await order();
      await fund();
      await financial().pay(
        o.id,
        { ...payment(), method: "cash", shiftId },
        randomUUID(),
      );
      await financial().createExpense(expense("cash"), randomUUID());
      await financial().createExpense(expense("bank"), randomUUID());
      const r = await new PostgresReporting(apiPool, {
        userId: ownerUser,
        tenantId: tenantA,
      }).operationalReport(reportPeriod("today"));
      expect(r.financial).toEqual({
        outstanding: "2000",
        expenses: "1000",
        supplierPayments: "1000",
        expenseCashOut: "500",
        supplierCashOut: "1000",
      });
      expect(r.sales.gross).toBe("0");
    });
  });
});

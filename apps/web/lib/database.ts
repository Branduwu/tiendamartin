import "server-only";
import {
  Pool,
  PostgresInventory,
  PostgresPurchasing,
  PostgresSales,
  PostgresCustomers,
  PostgresCash,
  PostgresSaleReturns,
  PostgresSuspendedSales,
  listTenantMemberships,
} from "@smartretail/database";
import { databaseConfiguration } from "./database-config";

let pool: Pool | undefined;
function databasePool() {
  if (!pool) {
    pool = new Pool(
      databaseConfiguration(
        process.env.DATABASE_URL,
        process.env.NODE_ENV === "production",
      ),
    );
    pool.on("error", () =>
      console.error("Database idle connection unavailable"),
    );
  }
  return pool;
}
export const tenantsForUser = (userId: string) =>
  listTenantMemberships(databasePool(), userId);
export const productsForUser = (userId: string, tenantId: string) =>
  new PostgresInventory(databasePool(), { userId, tenantId });
export const inventoryForUser = productsForUser;
export const salesForUser = (userId: string, tenantId: string) =>
  new PostgresSales(databasePool(), { userId, tenantId });

export const cashForUser = (userId: string, tenantId: string) =>
  new PostgresCash(databasePool(), { userId, tenantId });

export const suspendedSalesForUser = (userId: string, tenantId: string) =>
  new PostgresSuspendedSales(databasePool(), { userId, tenantId });

export const returnsForUser = (userId: string, tenantId: string) =>
  new PostgresSaleReturns(databasePool(), { userId, tenantId });

export const purchasingForUser = (
  userId: string,
  tenantId: string,
  correlationId?: string,
) =>
  new PostgresPurchasing(databasePool(), { userId, tenantId }, correlationId);

export const customersForUser = (
  userId: string,
  tenantId: string,
  correlationId?: string,
) => new PostgresCustomers(databasePool(), { userId, tenantId }, correlationId);

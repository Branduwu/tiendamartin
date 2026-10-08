import type { Pool, PoolClient } from "pg";
import { productId } from "@smartretail/domain";
import {
  PermissionDeniedError,
  PlatformCompanyNotFoundError,
  PlatformCompanyConflictError,
  type PlatformOverview,
  type PlatformCompanyDetail,
} from "@smartretail/application";
import { assertApplicationRole } from "./session";
export class PostgresPlatform {
  private readonly user: string;
  constructor(
    private readonly pool: Pool,
    user: string,
  ) {
    this.user = productId(user).toLowerCase();
  }
  private async transaction<T>(work: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    let broken = false;
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL statement_timeout='15s'");
      await assertApplicationRole(c);
      await c.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id','',true)",
        [this.user],
      );
      const result = await work(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        broken = true;
      }
      if (e instanceof Error && "code" in e) {
        if (e.code === "42501") throw new PermissionDeniedError();
        if (e.code === "P0002") throw new PlatformCompanyNotFoundError();
        if (e.code === "P0001") throw new PlatformCompanyConflictError();
        if (e.code === "23514") throw new TypeError("Invalid platform input");
      }
      throw e;
    } finally {
      c.release(broken);
    }
  }
  access() {
    return this.transaction(
      async (c) =>
        (
          await c.query<{ allowed: boolean }>(
            "SELECT retail.is_platform_admin() allowed",
          )
        ).rows[0]?.allowed === true,
    );
  }
  tenantStatus(id: string) {
    return this.transaction(
      async (c) =>
        (
          await c.query<{ status: "active" | "suspended" }>(
            "SELECT status FROM retail.membership_tenants() WHERE tenant_id=$1",
            [productId(id)],
          )
        ).rows[0]?.status,
    );
  }
  list(page = 1) {
    return this.transaction(
      async (c) =>
        (
          await c.query<{ result: PlatformOverview }>(
            "SELECT retail.platform_companies($1) result",
            [page],
          )
        ).rows[0]!.result,
    );
  }
  detail(id: string) {
    return this.transaction(
      async (c) =>
        (
          await c.query<{ result: PlatformCompanyDetail }>(
            "SELECT retail.platform_company($1) result",
            [productId(id)],
          )
        ).rows[0]!.result,
    );
  }
  users(search = "", page = 1) {
    return this.transaction(
      async (c) =>
        (
          await c.query<{ result: { id: string; email: string }[] }>(
            "SELECT retail.platform_auth_users($1,$2) result",
            [search, page],
          )
        ).rows[0]!.result,
    );
  }
  create(
    input: { id: string; displayName: string; ownerUserId: string },
    correlation: string,
  ) {
    return this.transaction(async (c) => {
      await c.query("SELECT retail.platform_create_company($1,$2,$3,$4)", [
        productId(input.id),
        input.displayName,
        productId(input.ownerUserId),
        productId(correlation),
      ]);
      return { id: input.id };
    });
  }
  changeStatus(
    id: string,
    status: "active" | "suspended",
    correlation: string,
    commandId = correlation,
  ) {
    return this.transaction(async (c) => {
      await c.query("SELECT retail.platform_company_status($1,$2,$3,$4)", [
        productId(id),
        status,
        productId(correlation),
        productId(commandId),
      ]);
      return { saved: true };
    });
  }
}

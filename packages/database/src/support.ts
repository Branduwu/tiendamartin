import type { Pool, PoolClient } from "pg";
import { productId } from "@smartretail/domain";
import {
  PermissionDeniedError,
  SupportUnavailableError,
  SupportConflictError,
  SupportRateLimitError,
  type SupportRepository,
  type SupportRequest,
  type SupportSummary,
  type SupportStatus,
  type CreateSupportRequest,
  type InitialSetup,
} from "@smartretail/application";
import { assertApplicationRole } from "./session";

export class PostgresSupport implements SupportRepository {
  constructor(
    private readonly pool: Pool,
    private readonly userId: string,
    private readonly tenantId?: string,
    private readonly platform = false,
  ) {
    productId(userId);
    if (tenantId) productId(tenantId);
  }
  private async transaction<T>(
    work: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await this.pool.connect();
    let broken = false;
    try {
      await c.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await c.query("SET LOCAL statement_timeout='15s'");
      await assertApplicationRole(c);
      await c.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
        [this.userId.toLowerCase(), this.tenantId?.toLowerCase() ?? ""],
      );
      const value = await work(c);
      await c.query("COMMIT");
      return value;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        broken = true;
      }
      if (e instanceof Error && "code" in e) {
        if (e.code === "42501") throw new PermissionDeniedError();
        if (e.code === "P0002") throw new SupportUnavailableError();
        if (e.code === "P0001") throw new SupportConflictError();
        if (e.code === "54000") throw new SupportRateLimitError();
        if (["23514", "23502", "22P02"].includes(String(e.code)))
          throw new TypeError("Invalid support input");
      }
      throw e;
    } finally {
      c.release(broken);
    }
  }
  create(v: CreateSupportRequest, correlation: string) {
    return this.transaction(
      async (c) =>
        (
          await c.query<{ result: SupportRequest }>(
            "SELECT retail.support_create($1,$2,$3,$4,$5,$6) result",
            [
              productId(v.id),
              v.category,
              v.subject,
              v.description,
              v.pagePath,
              productId(correlation),
            ],
          )
        ).rows[0]!.result,
    );
  }
  list(page = 1, status?: SupportStatus) {
    return this.transaction(async (c) => {
      const rows = (
        await c.query<{ result: SupportSummary[] }>(
          "SELECT retail.support_list($1,$2,$3) result",
          [page, this.platform, status ?? null],
        )
      ).rows[0]!.result;
      return { requests: rows.slice(0, 25), hasMore: rows.length > 25 };
    });
  }
  detail(id: string) {
    return this.transaction(
      async (c) =>
        (
          await c.query<{ result: SupportRequest }>(
            "SELECT retail.support_detail($1,$2) result",
            [productId(id), this.platform],
          )
        ).rows[0]!.result,
    );
  }
  changeStatus(id: string, status: SupportStatus, correlation: string) {
    return this.transaction(
      async (c) =>
        (
          await c.query<{ result: SupportRequest }>(
            "SELECT retail.support_status($1,$2,$3) result",
            [productId(id), status, productId(correlation)],
          )
        ).rows[0]!.result,
    );
  }
  initialSetup() {
    return this.transaction(async (c) => {
      await c.query("SELECT retail.lock_membership()");
      const allowed = await c.query<{ allowed: boolean }>(
        "SELECT retail.has_permission('settings.manage') allowed",
      );
      if (!allowed.rows[0]?.allowed) throw new PermissionDeniedError();
      return (
        await c.query<InitialSetup>(
          `SELECT
        true company,
        EXISTS(SELECT 1 FROM retail.inventory_locations WHERE tenant_id=$1 AND status='active') branch,
        EXISTS(SELECT 1 FROM retail.products WHERE tenant_id=$1 AND status='active') product,
        EXISTS(SELECT 1 FROM retail.inventory_movements WHERE tenant_id=$1 AND type='receipt') inventory,
        EXISTS(SELECT 1 FROM retail.list_members() WHERE user_id<>$2 AND status='active') team,
        EXISTS(SELECT 1 FROM retail.tax_profiles WHERE tenant_id=$1 AND active) taxes,
        EXISTS(SELECT 1 FROM retail.cash_register_shifts WHERE tenant_id=$1) cash,
        EXISTS(SELECT 1 FROM retail.sales WHERE tenant_id=$1) sale`,
          [this.tenantId, this.userId],
        )
      ).rows[0]!;
    });
  }
}

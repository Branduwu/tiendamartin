import type { Pool, PoolClient } from "pg";
import { productId } from "@smartretail/domain";
import { PermissionDeniedError } from "@smartretail/application";
import { assertApplicationRole } from "./session";
export class OnboardingConflictError extends Error {}
export class InvitationUnavailableError extends Error {}
export type Invitation = Readonly<{
  id: string;
  email: string;
  role: "admin" | "cashier" | "inventory_clerk";
  locationIds: string[];
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}>;
export class PostgresOnboarding {
  constructor(
    private readonly pool: Pool,
    private readonly userId: string,
  ) {
    productId(userId);
  }
  private async transaction<T>(
    tenantId: string | undefined,
    correlation: string,
    work: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await this.pool.connect();
    let broken = false;
    try {
      await c.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await c.query("SET LOCAL statement_timeout='15s'");
      await assertApplicationRole(c);
      await c.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true),set_config('app.correlation_id',$3,true)",
        [
          this.userId.toLowerCase(),
          tenantId ? productId(tenantId).toLowerCase() : "",
          productId(correlation),
        ],
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
        if (e.code === "P0001") throw new OnboardingConflictError();
        if (e.code === "P0002") throw new InvitationUnavailableError();
        if (["23514", "23502", "22P02"].includes(String(e.code)))
          throw new TypeError("Invalid onboarding input");
      }
      throw e;
    } finally {
      c.release(broken);
    }
  }
  onboard(
    input: {
      commandId: string;
      businessName: string;
      tradeName: string | null;
      phone: string | null;
      email: string | null;
      branchName: string;
    },
    correlation: string,
  ) {
    const { commandId, ...intent } = input;
    return this.transaction(
      undefined,
      correlation,
      async (c) =>
        (
          await c.query<{ result: { tenantId: string; locationId: string } }>(
            "SELECT retail.self_onboard($1,$2::jsonb,$3) result",
            [productId(commandId), JSON.stringify(intent), correlation],
          )
        ).rows[0]!.result,
    );
  }
  list(tenantId: string, correlation: string) {
    return this.transaction(
      tenantId,
      correlation,
      async (c) =>
        (
          await c.query<{ result: Invitation[] }>(
            "SELECT retail.list_invitations() result",
          )
        ).rows[0]!.result,
    );
  }
  create(
    tenantId: string,
    input: {
      email: string;
      role: string;
      locationIds: string[];
      expiresInDays: number;
    },
    hash: string,
    correlation: string,
  ) {
    return this.transaction(tenantId, correlation, async (c) => {
      const result = await c.query<{ id: string }>(
        "SELECT retail.create_invitation($1,$2,$3::uuid[],$4,$5,$6) id",
        [
          input.email,
          input.role,
          input.locationIds,
          input.expiresInDays,
          hash,
          correlation,
        ],
      );
      const id = result.rows[0]!.id;
      return (
        await c.query<{ result: Invitation[] }>(
          "SELECT retail.list_invitations() result",
        )
      ).rows[0]!.result.find((i) => i.id === id)!;
    });
  }
  revoke(tenantId: string, id: string, correlation: string) {
    return this.transaction(tenantId, correlation, async (c) => {
      await c.query("SELECT retail.revoke_invitation($1,$2)", [
        productId(id),
        correlation,
      ]);
      return { saved: true };
    });
  }
  accept(hash: string, correlation: string) {
    return this.transaction(undefined, correlation, async (c) => ({
      tenantId: (
        await c.query<{ id: string }>(
          "SELECT retail.accept_invitation($1,$2) id",
          [hash, correlation],
        )
      ).rows[0]!.id,
    }));
  }
}

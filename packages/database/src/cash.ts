import type { PoolClient } from "pg";
import {
  money,
  productId,
  inventoryLocationId,
  expectedCash,
  cashDifference,
} from "@smartretail/domain";
import {
  CashStateConflictError,
  type CashRepository,
  type CashRegisterShift,
  type CashMovement,
  type CashMoveInput,
  type OpenCashInput,
} from "@smartretail/application";
import { PostgresInventory, DatabaseUniquenessConflictError } from "./database";
import { bigintParameter, integer } from "./mapping";
interface ShiftRow {
  id: string;
  tenant_id: string;
  location_id: string;
  opened_by: string;
  opened_at: Date;
  opening_cash: string;
  status: "open" | "closed";
  closed_by: string | null;
  closed_at: Date | null;
  counted_cash: string | null;
  expected_cash: string | null;
  difference: string | null;
  sales_cash: string;
  cash_in: string;
  cash_out: string;
}
interface MovementRow {
  id: string;
  shift_id: string;
  type: "cash_in" | "cash_out";
  amount: string;
  reason: string;
  created_by: string;
  created_at: Date;
}
export class PostgresCash extends PostgresInventory implements CashRepository {
  private async shift(
    client: PoolClient,
    id: string,
  ): Promise<CashRegisterShift> {
    const r = await client.query<ShiftRow>(
      `SELECT c.*,
    coalesce((SELECT sum(p.amount_minor_units) FROM retail.sales s JOIN retail.sale_payments p ON p.tenant_id=s.tenant_id AND p.sale_id=s.id WHERE s.tenant_id=c.tenant_id AND s.shift_id=c.id AND p.method='cash'),0)::text sales_cash,
    coalesce((SELECT sum(m.amount) FROM retail.cash_movements m WHERE m.tenant_id=c.tenant_id AND m.shift_id=c.id AND m.type='cash_in'),0)::text cash_in,
    coalesce((SELECT sum(m.amount) FROM retail.cash_movements m WHERE m.tenant_id=c.tenant_id AND m.shift_id=c.id AND m.type='cash_out'),0)::text cash_out
    FROM retail.cash_register_shifts c WHERE c.tenant_id=$1 AND c.id=$2`,
      [this.tenant, id],
    );
    const row = r.rows[0];
    if (!row) throw new CashStateConflictError();
    const openingCash = money(integer(row.opening_cash)),
      salesCash = money(integer(row.sales_cash)),
      cashIn = money(integer(row.cash_in)),
      cashOut = money(integer(row.cash_out));
    const expected =
      row.expected_cash === null
        ? expectedCash(openingCash, salesCash, cashIn, cashOut)
        : money(integer(row.expected_cash));
    return Object.freeze({
      id: row.id,
      tenantId: row.tenant_id,
      locationId: row.location_id,
      openedBy: row.opened_by,
      openedAt: row.opened_at.toISOString(),
      openingCash,
      status: row.status,
      salesCash,
      cashIn,
      cashOut,
      expectedCash: expected,
      closedBy: row.closed_by,
      closedAt: row.closed_at?.toISOString() ?? null,
      countedCash:
        row.counted_cash === null ? null : money(integer(row.counted_cash)),
      difference:
        row.difference === null ? null : money(integer(row.difference)),
    });
  }
  private async cashOperation<T>(
    permission: "cash.read" | "cash.open" | "cash.move" | "cash.close",
    work: (client: PoolClient) => Promise<T>,
  ) {
    try {
      return await this.transaction(permission, work);
    } catch (e) {
      if (e instanceof Error && "code" in e && e.code === "22003")
        throw new RangeError("Cash exceeds storage range");
      if (
        e instanceof DatabaseUniquenessConflictError ||
        (e instanceof Error && "code" in e && e.code === "P0001")
      )
        throw new CashStateConflictError();
      throw e;
    }
  }
  currentShift(locationId: string) {
    return this.cashOperation("cash.read", async (c) => {
      const r = await c.query<{ id: string }>(
        "SELECT id FROM retail.cash_register_shifts WHERE tenant_id=$1 AND location_id=$2 ORDER BY (status='open') DESC,opened_at DESC,id DESC LIMIT 1",
        [this.tenant, inventoryLocationId(locationId)],
      );
      return r.rows[0] ? this.shift(c, r.rows[0].id) : null;
    });
  }
  openShift(input: OpenCashInput) {
    input = {
      ...input,
      id: productId(input.id).toLowerCase(),
      locationId: inventoryLocationId(input.locationId).toLowerCase(),
    };
    return this.cashOperation("cash.open", async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `smartretail.cash.open/${productId(input.id)}`,
      ]);
      const existing = await c.query<ShiftRow>(
        "SELECT * FROM retail.cash_register_shifts WHERE tenant_id=$1 AND id=$2",
        [this.tenant, input.id],
      );
      if (existing.rows[0]) {
        if (
          existing.rows[0].location_id !== input.locationId ||
          integer(existing.rows[0].opening_cash) !==
            input.openingCash.minorUnits
        )
          throw new CashStateConflictError();
        return this.shift(c, input.id);
      }
      await c.query(
        "INSERT INTO retail.cash_register_shifts(id,tenant_id,location_id,opened_by,opening_cash) VALUES($1,$2,$3,$4,$5)",
        [
          input.id,
          this.tenant,
          input.locationId,
          this.user,
          bigintParameter(input.openingCash.minorUnits),
        ],
      );
      return this.shift(c, input.id);
    });
  }
  moveCash(input: CashMoveInput) {
    input = {
      ...input,
      id: productId(input.id).toLowerCase(),
      shiftId: productId(input.shiftId).toLowerCase(),
    };
    return this.cashOperation("cash.move", async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `smartretail.cash.move/${productId(input.id)}`,
      ]);
      const prior = await c.query<MovementRow>(
        "SELECT * FROM retail.cash_movements WHERE tenant_id=$1 AND id=$2",
        [this.tenant, input.id],
      );
      const p = prior.rows[0];
      if (
        p &&
        (p.shift_id !== input.shiftId ||
          p.type !== input.type ||
          integer(p.amount) !== input.amount.minorUnits ||
          p.reason !== input.reason)
      )
        throw new CashStateConflictError();
      const row =
        p ??
        (
          await c.query<MovementRow>(
            "INSERT INTO retail.cash_movements(id,tenant_id,shift_id,type,amount,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [
              input.id,
              this.tenant,
              input.shiftId,
              input.type,
              bigintParameter(input.amount.minorUnits),
              input.reason,
              this.user,
            ],
          )
        ).rows[0];
      if (!row) throw new Error("Cash movement missing");
      return Object.freeze({
        id: row.id,
        shiftId: row.shift_id,
        type: row.type,
        amount: money(integer(row.amount)),
        reason: row.reason,
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
      }) satisfies CashMovement;
    });
  }
  closeShift(id: string, counted: ReturnType<typeof money>) {
    id = productId(id).toLowerCase();
    return this.cashOperation("cash.close", async (c) => {
      await c.query("SELECT retail.close_cash_shift($1,$2)", [
        productId(id),
        bigintParameter(counted.minorUnits),
      ]);
      const result = await this.shift(c, id);
      if (
        !result.countedCash ||
        result.difference?.minorUnits !==
          cashDifference(result.countedCash, result.expectedCash).minorUnits
      )
        throw new Error("Cash close mismatch");
      return result;
    });
  }
}

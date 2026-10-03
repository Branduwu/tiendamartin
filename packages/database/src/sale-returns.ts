import type { PoolClient } from "pg";
import {
  createSaleReturn,
  saleReturnId,
  assertRefundLimits,
  SaleReturnConflictError,
  saleId,
  productId,
  money,
  quantity,
  createInventoryReceipt,
  inventoryMovementId,
  inventoryLocationId,
  applyInventoryMovement,
  type UnitCode,
} from "@smartretail/domain";
import {
  returnCommand,
  SaleNotFoundError,
  CashStateConflictError,
  StockBalanceNotFoundError,
  InventoryIdempotencyConflictError,
  type SaleReturnInput,
  type StoredSaleReturn,
  type SaleReturnRepository,
} from "@smartretail/application";
import { PostgresSales } from "./sales";
import { DatabaseUniquenessConflictError } from "./database";
import {
  integer,
  bigintParameter,
  balanceFromRow,
  type BalanceRow,
} from "./mapping";
interface Header {
  id: string;
  tenant_id: string;
  sale_id: string;
  location_id: string;
  created_by: string;
  created_at: Date;
  total_minor_units: string;
  shift_id: string | null;
  cash_movement_id: string | null;
  command_payload: string;
}
export class PostgresSaleReturns
  extends PostgresSales
  implements SaleReturnRepository
{
  private async returned(client: PoolClient, id: string) {
    const row = (
      await client.query<Header>(
        "SELECT * FROM retail.sale_returns WHERE tenant_id=$1 AND id=$2",
        [this.tenant, id],
      )
    ).rows[0];
    if (!row) return undefined;
    const lines = await client.query<{
      product_id: string;
      unit: UnitCode;
      quantity_milli_units: string;
      refunded_minor_units: string;
    }>(
      "SELECT * FROM retail.sale_return_lines WHERE tenant_id=$1 AND return_id=$2 ORDER BY product_id",
      [this.tenant, id],
    );
    const refunds = await client.query<{
      method: "cash" | "card";
      amount_minor_units: string;
    }>(
      "SELECT * FROM retail.sale_return_refunds WHERE tenant_id=$1 AND return_id=$2 ORDER BY method",
      [this.tenant, id],
    );
    const record: StoredSaleReturn = Object.freeze({
      id: saleReturnId(row.id),
      saleId: row.sale_id,
      status: "completed",
      tenantId: row.tenant_id,
      locationId: row.location_id,
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
      shiftId: row.shift_id,
      cashMovementId: row.cash_movement_id,
      total: money(integer(row.total_minor_units)),
      lines: Object.freeze(
        lines.rows.map((l) =>
          Object.freeze({
            saleLineId: productId(l.product_id),
            productId: productId(l.product_id),
            quantity: quantity(l.unit, integer(l.quantity_milli_units)),
            refunded: money(integer(l.refunded_minor_units)),
          }),
        ),
      ),
      refunds: Object.freeze(
        refunds.rows.map((p) =>
          Object.freeze({
            method: p.method,
            amount: money(integer(p.amount_minor_units)),
          }),
        ),
      ),
    });
    return { record, payload: row.command_payload };
  }
  private async returns(client: PoolClient, sid: string) {
    const ids = await client.query<{ id: string }>(
      "SELECT id FROM retail.sale_returns WHERE tenant_id=$1 AND sale_id=$2 ORDER BY created_at,id",
      [this.tenant, sid],
    );
    const result: StoredSaleReturn[] = [];
    for (const row of ids.rows) {
      const found = await this.returned(client, row.id);
      if (found) result.push(found.record);
    }
    return result;
  }
  async listReturns(sid: string) {
    return this.transaction("sales.read", async (client) => {
      const original = await this.recorded(client, saleId(sid));
      if (!original) throw new SaleNotFoundError();
      return this.returns(client, saleId(sid));
    });
  }
  async returnSale(sid: string, input: SaleReturnInput) {
    const originalId = saleId(sid),
      { snapshot, payload } = returnCommand(originalId, input);
    try {
      return await this.transaction("sales.return", async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`smartretail.return/${snapshot.id}`],
        );
        const prior = await this.returned(client, snapshot.id);
        if (prior) {
          if (prior.record.saleId !== originalId || prior.payload !== payload)
            throw new SaleReturnConflictError("Return ID already used");
          return { record: prior.record, replayed: true };
        }
        await client.query("SELECT retail.lock_sale_for_return($1)", [
          originalId,
        ]);
        const original = await this.recorded(client, originalId);
        if (!original) throw new SaleNotFoundError();
        const previous = await this.returns(client, originalId);
        const result = createSaleReturn(
          snapshot.id,
          original.recorded.sale,
          snapshot.lines,
          previous,
          snapshot.refunds,
        );
        assertRefundLimits(
          original.recorded.payments,
          previous,
          result.refunds,
        );
        const cash =
          result.refunds.find((p) => p.method === "cash")?.amount.minorUnits ??
          0n;
        if (cash > 0n) {
          if (!snapshot.shiftId || !snapshot.cashMovementId)
            throw new CashStateConflictError();
          await client.query("SELECT retail.lock_cash_shift($1)", [
            snapshot.shiftId,
          ]);
          const shift = await client.query(
            "SELECT 1 FROM retail.cash_register_shifts WHERE tenant_id=$1 AND id=$2 AND location_id=$3 AND retail.cash_expected(id)>=$4",
            [
              this.tenant,
              snapshot.shiftId,
              original.recorded.locationId,
              bigintParameter(cash),
            ],
          );
          if (!shift.rows.length) throw new CashStateConflictError();
        } else if (
          snapshot.shiftId !== undefined ||
          snapshot.cashMovementId !== undefined
        )
          throw new TypeError("Card return has no cash movement");
        await client.query(
          "INSERT INTO retail.sale_returns(id,tenant_id,sale_id,location_id,created_by,total_minor_units,cash_refund_minor_units,shift_id,cash_movement_id,command_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            result.id,
            this.tenant,
            originalId,
            original.recorded.locationId,
            this.user,
            bigintParameter(result.total.minorUnits),
            bigintParameter(cash),
            snapshot.shiftId ?? null,
            snapshot.cashMovementId ?? null,
            payload,
          ],
        );
        for (const line of [...result.lines].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        )) {
          const row = (
            await client.query<BalanceRow>(
              "SELECT * FROM retail.lock_balance($1,$2)",
              [line.productId, original.recorded.locationId],
            )
          ).rows[0];
          if (!row) throw new StockBalanceNotFoundError();
          const movementId = snapshot.lines.find(
            (l) => l.productId === line.productId,
          )?.movementId;
          if (!movementId) throw new TypeError("Missing return receipt ID");
          const receipt = createInventoryReceipt({
            id: inventoryMovementId(movementId),
            productId: line.productId,
            locationId: inventoryLocationId(original.recorded.locationId),
            type: "receipt",
            quantity: line.quantity,
          });
          const next = applyInventoryMovement(balanceFromRow(row), receipt);
          await client.query(
            "INSERT INTO retail.inventory_commands(id,tenant_id,kind) VALUES($1,$2,'receipt')",
            [movementId, this.tenant],
          );
          await client.query(
            "INSERT INTO retail.inventory_movements(id,tenant_id,product_id,location_id,type,unit,amount,balance_after,sale_return_id) VALUES($1,$2,$3,$4,'receipt',$5,$6,$7,$8)",
            [
              movementId,
              this.tenant,
              line.productId,
              original.recorded.locationId,
              line.quantity.unit,
              bigintParameter(line.quantity.milliUnits),
              bigintParameter(next.quantity.milliUnits),
              result.id,
            ],
          );
          const returnedBefore = previous.reduce(
            (sum, r) =>
              sum +
              (r.lines.find((l) => l.productId === line.productId)?.quantity
                .milliUnits ?? 0n),
            0n,
          );
          await client.query(
            "INSERT INTO retail.sale_return_lines(tenant_id,return_id,sale_id,product_id,unit,quantity_milli_units,returned_before,refunded_minor_units,movement_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              this.tenant,
              result.id,
              originalId,
              line.productId,
              line.quantity.unit,
              bigintParameter(line.quantity.milliUnits),
              bigintParameter(returnedBefore),
              bigintParameter(line.refunded.minorUnits),
              movementId,
            ],
          );
        }
        if (cash > 0n)
          await client.query(
            "INSERT INTO retail.cash_movements(id,tenant_id,shift_id,type,amount,reason,created_by,sale_return_id) VALUES($1,$2,$3,'cash_out',$4,$5,$6,$7)",
            [
              snapshot.cashMovementId,
              this.tenant,
              snapshot.shiftId,
              bigintParameter(cash),
              `Sale return ${result.id}`,
              this.user,
              result.id,
            ],
          );
        for (const refund of result.refunds)
          await client.query(
            "INSERT INTO retail.sale_return_refunds(tenant_id,return_id,sale_id,method,amount_minor_units) VALUES($1,$2,$3,$4,$5)",
            [
              this.tenant,
              result.id,
              originalId,
              refund.method,
              bigintParameter(refund.amount.minorUnits),
            ],
          );
        await client.query(
          "SELECT retail.record_sale_return_audit($1::uuid,$2::uuid,$3::uuid,$4::uuid)",
          [result.id, originalId, result.id, snapshot.correlationId ?? null],
        );
        const stored = await this.returned(client, result.id);
        if (!stored) throw new Error("Return not persisted");
        return { record: stored.record, replayed: false };
      });
    } catch (error) {
      if (
        error instanceof DatabaseUniquenessConflictError ||
        error instanceof InventoryIdempotencyConflictError
      )
        throw new SaleReturnConflictError("Return or movement ID used");
      if (error instanceof Error && "code" in error) {
        if (error.code === "P0001")
          throw new SaleReturnConflictError("Return or cash conflict");
        if (error.code === "P0002") throw new SaleNotFoundError();
        if (error.code === "22003")
          throw new RangeError("Return exceeds storage range");
      }
      throw error;
    }
  }
}

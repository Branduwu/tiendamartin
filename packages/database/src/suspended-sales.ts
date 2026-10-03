import type { PoolClient } from "pg";
import { barcode, quantity, saleId, type UnitCode } from "@smartretail/domain";
import {
  suspensionCommand,
  rebuildSuspendedSale,
  SuspensionConflictError,
  SuspensionNotFoundError,
  ProductNotFoundError,
  StockBalanceNotFoundError,
  type SuspendedSale,
  type SuspensionInput,
} from "@smartretail/application";
import { PostgresSales } from "./sales";
import {
  bigintParameter,
  productFromRow,
  integer,
  type ProductRow,
} from "./mapping";
import { DatabaseUniquenessConflictError } from "./database";

interface Header {
  id: string;
  tenant_id: string;
  location_id: string;
  created_by: string;
  created_at: Date;
  status: SuspendedSale["status"];
  command_payload: string;
}
export class PostgresSuspendedSales extends PostgresSales {
  async lookupBarcode(code: string) {
    const exact = barcode(code);
    return this.transaction("products.read", async (client) => {
      const result = await client.query<ProductRow>(
        "SELECT * FROM retail.products WHERE tenant_id=$1 AND barcode=$2",
        [this.tenant, exact],
      );
      return result.rows[0] ? productFromRow(result.rows[0]) : undefined;
    });
  }
  private async suspended(client: PoolClient, id: string) {
    const header = (
      await client.query<Header>(
        "SELECT * FROM retail.suspended_sales WHERE tenant_id=$1 AND id=$2",
        [this.tenant, id],
      )
    ).rows[0];
    if (!header) throw new SuspensionNotFoundError();
    const lines = await client.query<{
      product_id: string;
      unit: UnitCode;
      quantity_milli_units: string;
    }>(
      "SELECT * FROM retail.suspended_sale_lines WHERE tenant_id=$1 AND suspended_sale_id=$2 ORDER BY product_id",
      [this.tenant, id],
    );
    const record: SuspendedSale = Object.freeze({
      id: header.id,
      tenantId: header.tenant_id,
      locationId: header.location_id,
      createdBy: header.created_by,
      createdAt: header.created_at.toISOString(),
      status: header.status,
      lines: Object.freeze(
        lines.rows.map((l) =>
          Object.freeze({
            productId: l.product_id,
            quantity: quantity(l.unit, integer(l.quantity_milli_units)),
          }),
        ),
      ),
    });
    return { record, payload: header.command_payload };
  }
  async suspend(input: SuspensionInput) {
    const { snapshot, payload } = suspensionCommand(input);
    try {
      return await this.transaction("sales.create", async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`smartretail.suspension/${snapshot.id}`],
        );
        const exists = await client.query(
          "SELECT 1 FROM retail.suspended_sales WHERE tenant_id=$1 AND id=$2",
          [this.tenant, snapshot.id],
        );
        if (exists.rows.length) {
          const prior = await this.suspended(client, snapshot.id);
          if (prior.payload !== payload) throw new SuspensionConflictError();
          return { record: prior.record, replayed: true };
        }
        const location = await client.query(
          "SELECT 1 FROM retail.inventory_locations WHERE tenant_id=$1 AND id=$2 AND status='active'",
          [this.tenant, snapshot.locationId],
        );
        if (!location.rows.length) throw new StockBalanceNotFoundError();
        for (const line of snapshot.lines) {
          const p = (
            await client.query<ProductRow>(
              "SELECT * FROM retail.products WHERE tenant_id=$1 AND id=$2 FOR SHARE",
              [this.tenant, line.productId],
            )
          ).rows[0];
          if (!p) throw new ProductNotFoundError();
          if (p.status !== "active" || p.unit !== line.quantity.unit)
            throw new SuspensionConflictError();
        }
        await client.query(
          "INSERT INTO retail.suspended_sales(id,tenant_id,location_id,created_by,command_payload) VALUES($1,$2,$3,$4,$5)",
          [snapshot.id, this.tenant, snapshot.locationId, this.user, payload],
        );
        for (const l of snapshot.lines)
          await client.query(
            "INSERT INTO retail.suspended_sale_lines(tenant_id,suspended_sale_id,product_id,unit,quantity_milli_units) VALUES($1,$2,$3,$4,$5)",
            [
              this.tenant,
              snapshot.id,
              l.productId,
              l.quantity.unit,
              bigintParameter(l.quantity.milliUnits),
            ],
          );
        return {
          record: (await this.suspended(client, snapshot.id)).record,
          replayed: false,
        };
      });
    } catch (error) {
      if (error instanceof DatabaseUniquenessConflictError)
        throw new SuspensionConflictError();
      throw error;
    }
  }
  async listSuspended() {
    return this.transaction("sales.read", async (client) => {
      const rows = await client.query<{ id: string }>(
        "SELECT id FROM retail.suspended_sales WHERE tenant_id=$1 AND status='suspended' ORDER BY created_at DESC,id DESC LIMIT 50",
        [this.tenant],
      );
      return Promise.all(
        rows.rows.map(async (r) => (await this.suspended(client, r.id)).record),
      );
    });
  }
  async recoverSuspended(id: string, newSaleId: string) {
    const validId = saleId(id),
      nextId = saleId(newSaleId);
    return this.transaction("sales.create", async (client) => {
      const { record } = await this.suspended(client, validId);
      try {
        await client.query("SELECT retail.lock_suspended_sale($1,$2)", [
          validId,
          record.locationId,
        ]);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "P0001")
          throw new SuspensionConflictError();
        throw error;
      }
      const products = [];
      for (const line of record.lines) {
        const row = (
          await client.query<ProductRow>(
            "SELECT * FROM retail.products WHERE tenant_id=$1 AND id=$2 FOR SHARE",
            [this.tenant, line.productId],
          )
        ).rows[0];
        if (!row) throw new ProductNotFoundError();
        products.push(productFromRow(row));
      }
      return { record, draft: rebuildSuspendedSale(record, products, nextId) };
    });
  }
  async cancelSuspended(id: string) {
    try {
      return await this.transaction("sales.create", async (client) => {
        const validId = saleId(id);
        await this.suspended(client, validId);
        await client.query("SELECT retail.cancel_suspended_sale($1)", [
          validId,
        ]);
        return (await this.suspended(client, validId)).record;
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P0001")
        throw new SuspensionConflictError();
      throw error;
    }
  }
}

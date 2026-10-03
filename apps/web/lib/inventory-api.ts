import "server-only";
import { randomUUID } from "node:crypto";
import {
  CreateInventoryLocationSchema,
  InventoryReceiptSchema,
  InventoryIssueSchema,
  InventoryAdjustmentSchema,
  InventoryCountSchema,
  InventoryTransferSchema,
  UuidSchema,
} from "@smartretail/contracts";
import {
  productId,
  inventoryLocationId,
  inventoryLocationCode,
  inventoryLocationName,
  inventoryMovementId,
  inventoryTransferId,
  inventoryAdjustmentReason,
  quantity,
  InsufficientStockError,
  IncompatibleQuantityUnitError,
  type StockBalance,
} from "@smartretail/domain";
import {
  listInventoryLocations,
  createLocation,
  listInventoryStock,
  receiveInventory,
  issueInventory,
  adjustInventory,
  reconcileInventory,
  transferInventory,
  PermissionDeniedError,
  StockBalanceNotFoundError,
  InventoryIdempotencyConflictError,
} from "@smartretail/application";
import { DatabaseUniquenessConflictError } from "@smartretail/database";
import { verifiedUserId } from "./auth";
import { inventoryForUser } from "./database";
import {
  InvalidInput,
  SameOriginError,
  reply,
  jsonBody,
  requireSameOrigin,
} from "./api";

export type InventoryOperation =
  | "locations"
  | "create-location"
  | "stock"
  | "receive"
  | "issue"
  | "adjustment"
  | "count"
  | "transfer";
const balanceDto = (balance: StockBalance) => ({
  ...balance,
  quantity: {
    unit: balance.quantity.unit,
    milliUnits: balance.quantity.milliUnits.toString(),
  },
});

export async function handleInventory(
  request: Request,
  operation: InventoryOperation,
) {
  const correlationId = randomUUID();
  try {
    const userId = await verifiedUserId();
    if (!userId) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success) throw new InvalidInput();
    const repo = inventoryForUser(userId, tenant.data);
    if (operation === "locations")
      return reply({ locations: await listInventoryLocations(repo) });
    if (operation === "stock") {
      const query = new URL(request.url).searchParams;
      if (
        [...query.keys()].some((key) => key !== "locationId") ||
        query.getAll("locationId").length > 1
      )
        throw new InvalidInput();
      const location = query.has("locationId")
        ? UuidSchema.safeParse(query.get("locationId"))
        : undefined;
      if (location && !location.success) throw new InvalidInput();
      return reply({
        stock: (await listInventoryStock(repo, location?.data)).map((row) => ({
          ...balanceDto(row.balance),
          productName: row.productName,
          sku: row.sku,
          locationName: row.locationName,
          locationCode: row.locationCode,
        })),
      });
    }
    requireSameOrigin(request);
    const body = await jsonBody(request);
    let result: unknown;
    let operationId: string;
    if (operation === "create-location") {
      const parsed = CreateInventoryLocationSchema.safeParse(body);
      if (!parsed.success) throw new InvalidInput();
      const value = parsed.data;
      operationId = value.id;
      result = {
        location: await createLocation(repo, {
          id: inventoryLocationId(value.id),
          code: inventoryLocationCode(value.code),
          name: inventoryLocationName(value.name),
          status: value.status,
        }),
      };
    } else if (operation === "transfer") {
      const parsed = InventoryTransferSchema.safeParse(body);
      if (!parsed.success) throw new InvalidInput();
      const value = parsed.data;
      operationId = value.id;
      const moved = await transferInventory(repo, {
        ...value,
        id: inventoryTransferId(value.id),
        productId: productId(value.productId),
        sourceLocationId: inventoryLocationId(value.sourceLocationId),
        destinationLocationId: inventoryLocationId(value.destinationLocationId),
        issueMovementId: inventoryMovementId(value.issueMovementId),
        receiptMovementId: inventoryMovementId(value.receiptMovementId),
        quantity: quantity(
          value.quantity.unit,
          BigInt(value.quantity.milliUnits),
        ),
      });
      result = {
        sourceBalance: balanceDto(moved.sourceBalance),
        destinationBalance: balanceDto(moved.destinationBalance),
      };
    } else if (operation === "count") {
      const parsed = InventoryCountSchema.safeParse(body);
      if (!parsed.success) throw new InvalidInput();
      const value = parsed.data;
      operationId = value.id;
      const counted = await reconcileInventory(repo, {
        id: inventoryMovementId(value.id),
        productId: productId(value.productId),
        locationId: inventoryLocationId(value.locationId),
        counted: quantity(value.counted.unit, BigInt(value.counted.milliUnits)),
        reason: inventoryAdjustmentReason(value.reason),
      });
      result = { status: counted.status, balance: balanceDto(counted.balance) };
    } else if (operation === "adjustment") {
      const parsed = InventoryAdjustmentSchema.safeParse(body);
      if (!parsed.success) throw new InvalidInput();
      const value = parsed.data;
      operationId = value.id;
      const adjusted = await adjustInventory(repo, {
        ...value,
        id: inventoryMovementId(value.id),
        productId: productId(value.productId),
        locationId: inventoryLocationId(value.locationId),
        delta: quantity(value.delta.unit, BigInt(value.delta.milliUnits)),
        reason: inventoryAdjustmentReason(value.reason),
      });
      result = { balance: balanceDto(adjusted.balance) };
    } else {
      const parsed = (
        operation === "receive" ? InventoryReceiptSchema : InventoryIssueSchema
      ).safeParse(body);
      if (!parsed.success) throw new InvalidInput();
      const value = parsed.data;
      operationId = value.id;
      const input = {
        ...value,
        id: inventoryMovementId(value.id),
        productId: productId(value.productId),
        locationId: inventoryLocationId(value.locationId),
        quantity: quantity(
          value.quantity.unit,
          BigInt(value.quantity.milliUnits),
        ),
      };
      const moved =
        operation === "receive"
          ? await receiveInventory(repo, { ...input, type: "receipt" })
          : await issueInventory(repo, { ...input, type: "issue" });
      result = { balance: balanceDto(moved.balance) };
    }
    console.info(
      JSON.stringify({
        operation: `inventory.${operation}`,
        operationId,
        userId,
        tenantId: tenant.data,
        correlationId,
        at: new Date().toISOString(),
      }),
    );
    return reply(result, operation === "create-location" ? 201 : 200);
  } catch (error) {
    if (
      error instanceof PermissionDeniedError ||
      error instanceof SameOriginError
    )
      return reply({ error: "No tienes permiso para esta operación." }, 403);
    if (
      error instanceof InvalidInput ||
      error instanceof RangeError ||
      error instanceof IncompatibleQuantityUnitError
    )
      return reply(
        { error: "Revisa los campos, la unidad y la cantidad." },
        400,
      );
    if (error instanceof StockBalanceNotFoundError)
      return reply({ error: "Producto o ubicación no encontrado." }, 404);
    if (error instanceof InsufficientStockError)
      return reply(
        { error: "Existencias insuficientes. El saldo no cambió." },
        409,
      );
    if (
      error instanceof InventoryIdempotencyConflictError ||
      error instanceof DatabaseUniquenessConflictError
    )
      return reply(
        { error: "El ID de operación ya está en uso para otro comando." },
        409,
      );
    console.error(
      JSON.stringify({
        operation,
        correlationId,
        at: new Date().toISOString(),
        outcome: "unexpected_error",
      }),
    );
    return reply(
      {
        error: "No se pudo confirmar la operación. Reintenta el mismo comando.",
        correlationId,
      },
      500,
    );
  }
}

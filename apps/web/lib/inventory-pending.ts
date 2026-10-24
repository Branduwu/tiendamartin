import {
  CreateInventoryLocationSchema,
  InventoryReceiptSchema,
  InventoryIssueSchema,
  InventoryAdjustmentSchema,
  InventoryCountSchema,
  InventoryTransferSchema,
  StockBalanceSchema,
  UuidSchema,
} from "@smartretail/contracts";
import type { Command } from "../app/inventory/inventory-form";

export type PendingInventory = Readonly<{ tenantId: string; command: Command }>;
const schemas = {
  "/api/v1/locations": CreateInventoryLocationSchema,
  "/api/v1/inventory/receive": InventoryReceiptSchema,
  "/api/v1/inventory/issue": InventoryIssueSchema,
  "/api/v1/inventory/adjustment": InventoryAdjustmentSchema,
  "/api/v1/inventory/count": InventoryCountSchema,
  "/api/v1/inventory/transfer": InventoryTransferSchema,
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const inventoryPendingKey = (userId: string) =>
  `smartretail.pending-inventory.${UuidSchema.parse(userId)}`;

/** Storage is untrusted. Keep uncertain commands, never silently replace their IDs. */
export function recoverPendingInventory(
  raw: string | null,
  allowedTenants: readonly string[],
):
  | { kind: "none" }
  | { kind: "blocked" }
  | { kind: "recover"; pending: PendingInventory } {
  if (raw === null) return { kind: "none" };
  try {
    if (raw.length > 65536) return { kind: "blocked" };
    const v: unknown = JSON.parse(raw);
    if (
      !record(v) ||
      Object.keys(v).length !== 2 ||
      typeof v.tenantId !== "string" ||
      !UuidSchema.safeParse(v.tenantId).success ||
      !allowedTenants.includes(v.tenantId) ||
      !record(v.command) ||
      Object.keys(v.command).length !== 2 ||
      typeof v.command.path !== "string" ||
      !Object.hasOwn(schemas, v.command.path) ||
      !schemas[v.command.path as keyof typeof schemas].safeParse(v.command.body)
        .success
    )
      return { kind: "blocked" };
    return {
      kind: "recover",
      pending: {
        tenantId: v.tenantId,
        command: { path: v.command.path, body: v.command.body },
      },
    };
  } catch {
    return { kind: "blocked" };
  }
}

export function persistPendingInventory(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  value: PendingInventory,
) {
  const encoded = JSON.stringify(value);
  if (recoverPendingInventory(encoded, [value.tenantId]).kind !== "recover")
    throw Error("INVALID_PENDING_INVENTORY");
  const prior = storage.getItem(key);
  if (prior !== null && prior !== encoded)
    throw Error("PENDING_INVENTORY_ALREADY_EXISTS");
  storage.setItem(key, encoded); // A failed write must prevent the request.
}

export function clearPendingInventory(
  storage: Pick<Storage, "getItem" | "removeItem">,
  key: string,
  value: PendingInventory,
) {
  const prior = storage.getItem(key);
  if (prior !== null && prior !== JSON.stringify(value))
    throw Error("PENDING_INVENTORY_CHANGED");
  storage.removeItem(key);
}

/** A JSON/HTTP success alone is insufficient to acknowledge a different resource. */
export function inventoryAcknowledged(
  command: Command,
  response: unknown,
): boolean {
  if (!record(response) || !record(command.body)) return false;
  const body = command.body;
  if (command.path === "/api/v1/locations") {
    const parsed = CreateInventoryLocationSchema.safeParse(response.location);
    return parsed.success && parsed.data.id === body.id;
  }
  const expectedQuantity = body.quantity ?? body.delta ?? body.counted;
  if (!record(expectedQuantity)) return false;
  const balance = (value: unknown, locationId: unknown) => {
    const parsed = StockBalanceSchema.safeParse(value);
    return (
      parsed.success &&
      parsed.data.productId === body.productId &&
      parsed.data.locationId === locationId &&
      parsed.data.quantity.unit === expectedQuantity.unit &&
      (command.path !== "/api/v1/inventory/count" ||
        parsed.data.quantity.milliUnits === expectedQuantity.milliUnits)
    );
  };
  if (command.path === "/api/v1/inventory/transfer")
    return (
      balance(response.sourceBalance, body.sourceLocationId) &&
      balance(response.destinationBalance, body.destinationLocationId)
    );
  return (
    balance(response.balance, body.locationId) &&
    (command.path !== "/api/v1/inventory/count" ||
      ["adjusted", "no-change"].includes(String(response.status)))
  );
}

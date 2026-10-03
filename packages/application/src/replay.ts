import type { InventoryMovement, InventoryTransfer } from "@smartretail/domain";

export class InventoryIdempotencyConflictError extends Error {
  constructor() {
    super("Inventory ID already used with different content");
    this.name = "InventoryIdempotencyConflictError";
  }
}

function canonical(value: unknown, key: string): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && (key === "id" || key.endsWith("Id")))
    return value.toLowerCase();
  return value;
}

// Inputs are reconstructed domain objects with stable field order, never raw DTOs.
export function assertSameInstruction(
  a: InventoryMovement | InventoryTransfer,
  b: InventoryMovement | InventoryTransfer,
): void {
  const encode = (value: InventoryMovement | InventoryTransfer) =>
    JSON.stringify(value, (key, field: unknown) => canonical(field, key));
  if (encode(a) !== encode(b)) throw new InventoryIdempotencyConflictError();
}

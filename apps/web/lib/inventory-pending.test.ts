import { expect, it, vi } from "vitest";
import {
  inventoryPendingKey,
  recoverPendingInventory,
  persistPendingInventory,
  clearPendingInventory,
  inventoryAcknowledged,
} from "./inventory-pending";
const tenantId = "550e8400-e29b-41d4-a716-446655440001";
const other = "550e8400-e29b-41d4-a716-446655440002";
const id = "550e8400-e29b-41d4-a716-446655440003";
const productId = "550e8400-e29b-41d4-a716-446655440010";
const locationId = "550e8400-e29b-41d4-a716-446655440011";
const quantity = { unit: "piece", milliUnits: "1000" };
const value = {
  tenantId,
  command: {
    path: "/api/v1/inventory/receive",
    body: { id, productId, locationId, type: "receipt", quantity },
  },
};
const key = inventoryPendingKey(other);
function storage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => {
      entries.set(k, v);
    },
    removeItem: (k: string) => {
      entries.delete(k);
    },
  };
}
it("survives a reload with precisely the original ID, tenant and payload", () => {
  const s = storage();
  persistPendingInventory(s, key, value);
  expect(recoverPendingInventory(s.getItem(key), [tenantId])).toEqual({
    kind: "recover",
    pending: value,
  });
});
it("isolates account keys and never overwrites another uncertain command", () => {
  expect(inventoryPendingKey(tenantId)).not.toBe(key);
  const s = storage();
  persistPendingInventory(s, key, value);
  expect(() =>
    persistPendingInventory(s, key, { ...value, tenantId: other }),
  ).toThrow();
  expect(s.getItem(key)).toBe(JSON.stringify(value));
});
it.each([
  "not JSON",
  "{}",
  "[]",
  "x".repeat(65537),
  JSON.stringify({ ...value, tenantId: other }),
  JSON.stringify({
    ...value,
    command: { ...value.command, path: "https://example.invalid" },
  }),
  JSON.stringify({ ...value, command: { ...value.command, body: {} } }),
  JSON.stringify({ ...value, extra: true }),
])(
  "blocks corrupt, foreign or unexpected storage without discarding it",
  (raw) => {
    expect(recoverPendingInventory(raw, [tenantId])).toEqual({
      kind: "blocked",
    });
  },
);
it("storage failures propagate before dispatch and cleanup never erases a different command", () => {
  const s = storage(),
    setItem = vi.fn(() => {
      throw Error("STORAGE_UNAVAILABLE");
    });
  expect(() =>
    persistPendingInventory({ ...s, setItem }, key, value),
  ).toThrow();
  expect(s.getItem(key)).toBeNull();
  persistPendingInventory(s, key, value);
  expect(() =>
    clearPendingInventory(s, key, { ...value, tenantId: other }),
  ).toThrow();
  expect(s.getItem(key)).toBe(JSON.stringify(value));
  clearPendingInventory(s, key, value);
  expect(s.getItem(key)).toBeNull();
});
it("preserves all three transfer IDs and counts without inventing an instruction", () => {
  const command = {
    path: "/api/v1/inventory/transfer",
    body: {
      id,
      productId,
      sourceLocationId: locationId,
      destinationLocationId: other,
      issueMovementId: tenantId,
      receiptMovementId: productId,
      quantity,
    },
  };
  const raw = JSON.stringify({ tenantId, command });
  expect(recoverPendingInventory(raw, [tenantId])).toEqual({
    kind: "recover",
    pending: { tenantId, command },
  });
});
it("accepts only an acknowledgement for the expected resource", () => {
  const balance = { productId, locationId, quantity };
  expect(inventoryAcknowledged(value.command, { balance })).toBe(true);
  expect(inventoryAcknowledged(value.command, {})).toBe(false);
  expect(
    inventoryAcknowledged(value.command, {
      balance: { ...balance, locationId: other },
    }),
  ).toBe(false);
  const count = {
    path: "/api/v1/inventory/count",
    body: {
      id,
      productId,
      locationId,
      counted: quantity,
      reason: "Conteo ficticio",
    },
  };
  expect(inventoryAcknowledged(count, { balance, status: "no-change" })).toBe(
    true,
  );
  expect(inventoryAcknowledged(count, { balance })).toBe(false);
});

it.each([
  { unit: "kg", milliUnits: "1000" },
  { unit: "piece", milliUnits: "2000" },
])(
  "does not clear a count whose acknowledgement has a different quantity or unit",
  (returned) => {
    const command = {
      path: "/api/v1/inventory/count",
      body: {
        id,
        productId,
        locationId,
        counted: quantity,
        reason: "Conteo ficticio",
      },
    };
    expect(
      inventoryAcknowledged(command, {
        status: "no-change",
        balance: { productId, locationId, quantity: returned },
      }),
    ).toBe(false);
  },
);
it("does not compare absolute receipt balances with the received amount, but requires its unit", () => {
  expect(
    inventoryAcknowledged(value.command, {
      balance: {
        productId,
        locationId,
        quantity: { unit: "piece", milliUnits: "9000" },
      },
    }),
  ).toBe(true);
  expect(
    inventoryAcknowledged(value.command, {
      balance: {
        productId,
        locationId,
        quantity: { unit: "kg", milliUnits: "9000" },
      },
    }),
  ).toBe(false);
});

import { describe, expect, it } from "vitest";
import {
  productId,
  inventoryLocationId,
  inventoryMovementId,
  inventoryTransferId,
  inventoryAdjustmentReason,
  quantity,
  stockBalance,
  InsufficientStockError,
  InvalidOperationalStockBalanceError,
  InventoryMovementTargetMismatchError,
  IncompatibleQuantityUnitError,
  type InventoryReceipt,
  type InventoryIssue,
  type InventoryAdjustment,
  type InventoryTransfer,
} from "@smartretail/domain";
import {
  receiveInventory,
  issueInventory,
  adjustInventory,
  transferInventory,
  reconcileInventory,
  StockBalanceNotFoundError,
  InvalidInventoryCountError,
  type ReconcileInventoryInput,
} from "../src/index";
import { FakeInventory } from "./fake-inventory";

const product = productId("550e8400-e29b-41d4-a716-446655440000");
const source = inventoryLocationId("550e8400-e29b-41d4-a716-446655440001");
const destination = inventoryLocationId("550e8400-e29b-41d4-a716-446655440002");
const id = inventoryMovementId("550e8400-e29b-41d4-a716-446655440003");
const receiptId = inventoryMovementId("550e8400-e29b-41d4-a716-446655440004");
const reason = inventoryAdjustmentReason("Physical count");
const key = { productId: product, locationId: source };
const destinationKey = { productId: product, locationId: destination };
const receipt: InventoryReceipt = {
  ...key,
  id,
  type: "receipt",
  quantity: quantity("piece", 3000n),
};
const issue: InventoryIssue = {
  ...key,
  id,
  type: "issue",
  quantity: quantity("piece", 3000n),
};
const adjustment: InventoryAdjustment = {
  ...key,
  id,
  type: "adjustment",
  delta: quantity("piece", -3000n),
  reason,
};
const transfer: InventoryTransfer = {
  id: inventoryTransferId("550e8400-e29b-41d4-a716-446655440005"),
  issueMovementId: id,
  receiptMovementId: receiptId,
  productId: product,
  sourceLocationId: source,
  destinationLocationId: destination,
  quantity: quantity("piece", 3000n),
};
const count: ReconcileInventoryInput = {
  ...key,
  id,
  reason,
  counted: quantity("piece", 12000n),
};
function setup(amount = 10000n) {
  return new FakeInventory([
    stockBalance({ ...key, quantity: quantity("piece", amount) }),
    stockBalance({ ...destinationKey, quantity: quantity("piece", 4000n) }),
  ]);
}

describe("application inventory orchestration", () => {
  it("receives stock and appends its receipt before saving the derived balance", async () => {
    const db = setup();
    const result = await receiveInventory(db, receipt);
    expect(result.balance.quantity.milliUnits).toBe(13000n);
    expect(db.movements.get(id)).toEqual(result.movement);
    expect(db.events).toEqual([
      "begin",
      "read",
      "movement1",
      "save1",
      "commit",
    ]);
    expect(db.targets).toEqual([key]);
  });
  it("issues stock", async () => {
    const db = setup();
    expect((await issueInventory(db, issue)).balance.quantity.milliUnits).toBe(
      7000n,
    );
    expect(db.movements.get(id)?.type).toBe("issue");
  });
  it("adjusts through the existing domain movement", async () => {
    const db = setup();
    expect(
      (await adjustInventory(db, adjustment)).balance.quantity.milliUnits,
    ).toBe(7000n);
    expect(db.movements.get(id)).toEqual(adjustment);
  });
  it("transfers with two movements and both balances in the same unit of work", async () => {
    const db = setup();
    const result = await transferInventory(db, transfer);
    expect(result.sourceBalance.quantity.milliUnits).toBe(7000n);
    expect(result.destinationBalance.quantity.milliUnits).toBe(7000n);
    expect(db.movements.get(id)).toMatchObject({
      type: "issue",
      locationId: source,
    });
    expect(db.movements.get(receiptId)).toMatchObject({
      type: "receipt",
      locationId: destination,
    });
    expect(db.transfers.get(transfer.id)).toEqual(transfer);
    expect(db.targets).toEqual([key, destinationKey]);
  });
  it("allows draining a balance to zero", async () => {
    const db = setup(3000n);
    expect((await issueInventory(db, issue)).balance.quantity.milliUnits).toBe(
      0n,
    );
  });
  it("rejects insufficient stock without ledger writes", async () => {
    const db = setup(2000n);
    await expect(issueInventory(db, issue)).rejects.toBeInstanceOf(
      InsufficientStockError,
    );
    expect(db.movements.size).toBe(0);
    expect(db.balance(key)?.quantity.milliUnits).toBe(2000n);
  });
  it("rejects an adjustment below zero", async () => {
    const db = setup(2000n);
    await expect(adjustInventory(db, adjustment)).rejects.toBeInstanceOf(
      InsufficientStockError,
    );
    expect(db.movements.size).toBe(0);
  });
  it("does not cure negative stock through receipt", async () => {
    const db = setup(-1n);
    await expect(receiveInventory(db, receipt)).rejects.toBeInstanceOf(
      InvalidOperationalStockBalanceError,
    );
    expect(db.movements.size).toBe(0);
  });
  it.each(["product", "location"])(
    "rejects a repository returning the wrong %s",
    async (field) => {
      const db = setup();
      db.readOverride = stockBalance({
        ...key,
        ...(field === "product"
          ? { productId: productId("550e8400-e29b-41d4-a716-446655440099") }
          : { locationId: destination }),
        quantity: quantity("piece", 10000n),
      });
      await expect(receiveInventory(db, receipt)).rejects.toBeInstanceOf(
        InventoryMovementTargetMismatchError,
      );
      expect(db.movements.size).toBe(0);
    },
  );
  it("rejects incompatible units", async () => {
    const db = setup();
    await expect(
      receiveInventory(db, { ...receipt, quantity: quantity("kg", 1000n) }),
    ).rejects.toBeInstanceOf(IncompatibleQuantityUnitError);
  });
  it("does not invent a zero balance when the target is missing", async () => {
    const db = new FakeInventory([]);
    await expect(receiveInventory(db, receipt)).rejects.toBeInstanceOf(
      StockBalanceNotFoundError,
    );
  });
  it("validates forged inputs before opening a transaction", async () => {
    const db = setup();
    await expect(
      Reflect.apply(receiveInventory, undefined, [
        db,
        { ...receipt, quantity: { unit: "piece", milliUnits: 3 } },
      ]),
    ).rejects.toThrow();
    expect(db.events).toEqual([]);
  });
  it("snapshots inputs before asynchronous persistence and returns immutable results", async () => {
    const db = setup();
    const input = {
      ...receipt,
      quantity: { unit: receipt.quantity.unit, milliUnits: 3000n },
    };
    const pending = receiveInventory(db, input);
    input.quantity.milliUnits = 999n;
    const result = await pending;
    expect(result.balance.quantity.milliUnits).toBe(13000n);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.balance.quantity)).toBe(true);
    expect(receipt.quantity.milliUnits).toBe(3000n);
  });
  it.each(["begin", "read", "movement1", "save1", "commit"])(
    "propagates %s failure and relies on transaction rollback",
    async (step) => {
      const db = setup();
      db.failAt = step;
      await expect(receiveInventory(db, receipt)).rejects.toBe(db.failure);
      expect(db.balance(key)?.quantity.milliUnits).toBe(10000n);
      expect(db.movements.size).toBe(0);
    },
  );
  it("rejects reused movement IDs via the adapter without applying twice", async () => {
    const db = setup();
    await receiveInventory(db, receipt);
    await expect(
      receiveInventory(db, { ...receipt, quantity: quantity("piece", 1n) }),
    ).rejects.toThrow("duplicate movement ID");
    expect(db.balance(key)?.quantity.milliUnits).toBe(13000n);
    expect(db.movements.size).toBe(1);
  });
  it("does not keep a global ID cache across independent adapters", async () => {
    for (const db of [setup(), setup()]) {
      expect(
        (await receiveInventory(db, receipt)).balance.quantity.milliUnits,
      ).toBe(13000n);
    }
  });
});

describe("transfer failures", () => {
  it("rejects an invalid destination before any writes", async () => {
    const db = new FakeInventory([
      stockBalance({ ...key, quantity: quantity("piece", 10000n) }),
      stockBalance({ ...destinationKey, quantity: quantity("kg", 4000n) }),
    ]);
    await expect(transferInventory(db, transfer)).rejects.toBeInstanceOf(
      IncompatibleQuantityUnitError,
    );
    expect(db.balance(key)?.quantity.milliUnits).toBe(10000n);
    expect(db.events).toEqual(["begin", "read", "read"]);
  });
  it.each(["transfer", "movement2", "save2", "commit"])(
    "has no partial committed result on %s failure in the transactional fake",
    async (step) => {
      const db = setup();
      db.failAt = step;
      let result;
      await expect(
        transferInventory(db, transfer).then((value) => {
          result = value;
        }),
      ).rejects.toBe(db.failure);
      expect(result).toBeUndefined();
      expect(db.balance(key)?.quantity.milliUnits).toBe(10000n);
      expect(db.balance(destinationKey)?.quantity.milliUnits).toBe(4000n);
      expect(db.movements.size).toBe(0);
      expect(db.transfers.size).toBe(0);
    },
  );
  it("rolls back transfer metadata when a child movement ID already exists", async () => {
    const db = setup();
    await receiveInventory(db, { ...receipt, id: receiptId });
    await expect(transferInventory(db, transfer)).rejects.toThrow(
      "duplicate movement ID",
    );
    expect(db.balance(key)?.quantity.milliUnits).toBe(13000n);
    expect(db.balance(destinationKey)?.quantity.milliUnits).toBe(4000n);
    expect(db.transfers.size).toBe(0);
    expect(db.movements.size).toBe(1);
  });
  it("rejects a reused transfer ID even with fresh child IDs", async () => {
    const db = setup();
    await transferInventory(db, transfer);
    await expect(
      transferInventory(db, {
        ...transfer,
        issueMovementId: inventoryMovementId(
          "550e8400-e29b-41d4-a716-446655440011",
        ),
        receiptMovementId: inventoryMovementId(
          "550e8400-e29b-41d4-a716-446655440012",
        ),
      }),
    ).rejects.toThrow("duplicate transfer ID");
    expect(db.balance(key)?.quantity.milliUnits).toBe(7000n);
    expect(db.movements.size).toBe(2);
  });
});

describe("physical reconciliation", () => {
  it.each([12000n, 8000n, 0n])(
    "counts %s using an adjustment, not a direct overwrite",
    async (amount) => {
      const db = setup();
      const result = await reconcileInventory(db, {
        ...count,
        counted: quantity("piece", amount),
      });
      expect(result.status).toBe("adjusted");
      if (result.status !== "adjusted") throw new Error("Expected adjustment");
      expect(result.movement.delta.milliUnits).toBe(amount - 10000n);
      expect(result.balance.quantity.milliUnits).toBe(amount);
      expect(db.movements.get(id)).toEqual(result.movement);
      expect(db.events).toEqual([
        "begin",
        "read",
        "movement1",
        "save1",
        "commit",
      ]);
    },
  );
  it("returns no-change without saving or creating a zero movement", async () => {
    const db = setup();
    const result = await reconcileInventory(db, {
      ...count,
      counted: quantity("piece", 10000n),
    });
    expect(result).toEqual({ status: "no-change", balance: db.balance(key) });
    expect(db.events).toEqual(["begin", "read", "commit"]);
    expect(db.movements.size).toBe(0);
  });
  it("rejects a negative count before persistence", async () => {
    const db = setup();
    await expect(
      reconcileInventory(db, { ...count, counted: quantity("piece", -1n) }),
    ).rejects.toBeInstanceOf(InvalidInventoryCountError);
    expect(db.events).toEqual([]);
  });
  it("does not use reconciliation to bypass negative operational stock", async () => {
    const db = setup(-1000n);
    await expect(reconcileInventory(db, count)).rejects.toBeInstanceOf(
      InvalidOperationalStockBalanceError,
    );
    expect(db.movements.size).toBe(0);
  });
  it("validates the target even for equal counts", async () => {
    const db = setup();
    db.readOverride = stockBalance({
      ...destinationKey,
      quantity: quantity("piece", 12000n),
    });
    await expect(reconcileInventory(db, count)).rejects.toBeInstanceOf(
      InventoryMovementTargetMismatchError,
    );
  });
  it("rejects different units even if numeric counts match", async () => {
    const db = setup();
    await expect(
      reconcileInventory(db, { ...count, counted: quantity("kg", 10000n) }),
    ).rejects.toBeInstanceOf(IncompatibleQuantityUnitError);
  });
  it.each(["id", "reason"])(
    "validates %s even when no change would be needed",
    async (field) => {
      const db = setup();
      await expect(
        Reflect.apply(reconcileInventory, undefined, [
          db,
          { ...count, counted: quantity("piece", 10000n), [field]: "" },
        ]),
      ).rejects.toThrow();
      expect(db.events).toEqual([]);
    },
  );
  it("snapshots counted quantity and does not mutate the original balance", async () => {
    const db = setup();
    const before = db.balance(key);
    const input = {
      ...count,
      counted: { unit: count.counted.unit, milliUnits: 12000n },
    };
    const pending = reconcileInventory(db, input);
    input.counted.milliUnits = 1n;
    const result = await pending;
    expect(result.balance.quantity.milliUnits).toBe(12000n);
    expect(before?.quantity.milliUnits).toBe(10000n);
  });
});

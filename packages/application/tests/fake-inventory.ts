import type {
  StockBalance,
  InventoryMovement,
  InventoryTransfer,
} from "@smartretail/domain";
import type {
  InventoryTransaction,
  InventoryUnitOfWork,
  StockTarget,
} from "../src/index";

function key(target: StockTarget): string {
  return `${target.productId.toLowerCase()}/${target.locationId.toLowerCase()}`;
}

/** Test-only staging/rollback model. No concurrent or durable database semantics. */
export class FakeInventory implements InventoryUnitOfWork {
  balances: Map<string, StockBalance>;
  movements = new Map<string, InventoryMovement>();
  transfers = new Map<string, InventoryTransfer>();
  readonly events: string[] = [];
  targets: readonly StockTarget[] = [];
  failAt: string | undefined;
  readOverride: StockBalance | undefined;
  readonly failure = new Error("fake persistence failure");

  constructor(initial: readonly StockBalance[]) {
    this.balances = new Map(initial.map((balance) => [key(balance), balance]));
  }

  balance(target: StockTarget): StockBalance | undefined {
    return this.balances.get(key(target));
  }

  async run<T>(
    targets: readonly StockTarget[],
    work: (tx: InventoryTransaction) => Promise<T>,
  ): Promise<T> {
    this.targets = targets;
    const balances = new Map(this.balances);
    const movements = new Map(this.movements);
    const transfers = new Map(this.transfers);
    let saves = 0;
    let appends = 0;
    const step = (event: string) => {
      this.events.push(event);
      if (this.failAt === event) throw this.failure;
    };
    step("begin");
    const result = await work({
      readBalance: async (target) => {
        step("read");
        return this.readOverride ?? balances.get(key(target));
      },
      saveBalance: async (balance) => {
        step(`save${++saves}`);
        balances.set(key(balance), balance);
      },
      appendMovement: async (movement) => {
        step(`movement${++appends}`);
        const id = movement.id.toLowerCase();
        if (movements.has(id)) throw new Error("duplicate movement ID");
        movements.set(id, movement);
      },
      appendTransfer: async (transfer) => {
        step("transfer");
        const id = transfer.id.toLowerCase();
        if (transfers.has(id)) throw new Error("duplicate transfer ID");
        transfers.set(id, transfer);
      },
    });
    step("commit");
    this.balances = balances;
    this.movements = movements;
    this.transfers = transfers;
    return result;
  }
}

import { expect, it } from "vitest";
import { recoverPendingSale } from "./pos-pending";
const tenantId = "550e8400-e29b-41d4-a716-446655440001",
  id = "550e8400-e29b-41d4-a716-446655440010";
const command = {
  draft: {
    id,
    status: "draft",
    lines: [
      {
        productId: id,
        name: "Café",
        sku: "CAFE",
        unit: "piece",
        quantity: { unit: "piece", milliUnits: "1000" },
        unitPrice: { currency: "MXN", minorUnits: "101" },
        lineTotal: { currency: "MXN", minorUnits: "101" },
      },
    ],
    total: { currency: "MXN", minorUnits: "101" },
  },
  locationId: "550e8400-e29b-41d4-a716-446655440011",
  payments: [
    { method: "cash", amount: { currency: "MXN", minorUnits: "50" } },
    { method: "card", amount: { currency: "MXN", minorUnits: "51" } },
  ],
  movements: [
    { productId: id, movementId: "550e8400-e29b-41d4-a716-446655440013" },
  ],
};
it("recovers exact SaleId/movement IDs and displays the original mixed payment", () => {
  const restored = recoverPendingSale(JSON.stringify({ tenantId, command }), [
    tenantId,
  ]);
  expect(restored.kind).toBe("recover");
  if (restored.kind !== "recover") throw new Error("Expected recovery");
  expect(restored.command).toEqual(command);
  expect(restored.method).toBe("mixed");
  expect(restored.cash).toBe("0.50");
});
it("unreadable, invalid and unavailable-tenant pending commands block new sales", () => {
  for (const raw of [
    "{",
    "{}",
    JSON.stringify({ tenantId, command: { ...command, userId: "forged" } }),
    JSON.stringify({ tenantId, command }),
  ])
    expect(recoverPendingSale(raw, []).kind).toBe("blocked");
});
it("no pending command does not block; forged payment cannot be recovered", () => {
  expect(recoverPendingSale(null, [tenantId])).toEqual({ kind: "none" });
  expect(
    recoverPendingSale(
      JSON.stringify({
        tenantId,
        command: {
          ...command,
          payments: [
            { method: "cash", amount: { currency: "MXN", minorUnits: "102" } },
          ],
        },
      }),
      [tenantId],
    ).kind,
  ).toBe("blocked");
});

it("recovers a base draft and net payment with its original manual discount", () => {
  const discounted = {
    ...command,
    discounts: { sale: { type: "amount", value: "11" } },
    payments: [
      { method: "card", amount: { currency: "MXN", minorUnits: "90" } },
    ],
  };
  const r = recoverPendingSale(
    JSON.stringify({ tenantId, command: discounted }),
    [tenantId],
  );
  expect(r.kind).toBe("recover");
  if (r.kind === "recover") expect(r.command).toEqual(discounted);
});
it("recovers automatic promotions and zero-paid sales without a manual intent", () => {
  for (const payments of [
    [],
    [{ method: "card", amount: { currency: "MXN", minorUnits: "90" } }],
  ])
    expect(
      recoverPendingSale(
        JSON.stringify({ tenantId, command: { ...command, payments } }),
        [tenantId],
      ).kind,
    ).toBe("recover");
});
it("blocks an inconsistent net draft so retry retains the original gross snapshot", () => {
  const inconsistent = {
    ...command,
    draft: { ...command.draft, total: { currency: "MXN", minorUnits: "90" } },
    discounts: { sale: { type: "amount", value: "11" } },
  };
  expect(
    recoverPendingSale(JSON.stringify({ tenantId, command: inconsistent }), [
      tenantId,
    ]).kind,
  ).toBe("blocked");
});

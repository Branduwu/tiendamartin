import {
  CheckoutSchema,
  UuidSchema,
  type CheckoutDto,
} from "@smartretail/contracts";
import { completeSale, salePayments } from "@smartretail/domain";
import { checkoutInput } from "./sale-mapping";
import { minorUnitsToDecimal } from "./money-input";
type Recovery =
  | { kind: "none" }
  | { kind: "blocked"; message: string }
  | {
      kind: "recover";
      tenantId: string;
      command: CheckoutDto;
      method: "cash" | "card" | "mixed";
      cash: string;
    };
/** Never discard or overwrite an existing command whose outcome is uncertain. */
export function recoverPendingSale(
  raw: string | null,
  allowedTenants: readonly string[],
): Recovery {
  if (raw === null) return { kind: "none" };
  const blocked: Recovery = {
    kind: "blocked",
    message:
      "Hay una venta pendiente que no podemos recuperar con tu acceso actual. Conservamos su identificador; consulta su estado antes de comenzar otra venta.",
  };
  try {
    if (raw.length > 65536) return blocked;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !("tenantId" in value) ||
      !("command" in value)
    )
      return blocked;
    const tenant = UuidSchema.safeParse(value.tenantId),
      parsed = CheckoutSchema.safeParse(value.command);
    if (
      !tenant.success ||
      !allowedTenants.includes(tenant.data) ||
      !parsed.success
    )
      return blocked;
    const input = checkoutInput(parsed.data);
    completeSale(input.draft);
    const paid = input.payments.reduce((s, p) => s + p.amount.minorUnits, 0n);
    if (!input.taxes?.length && paid > input.draft.total.minorUnits)
      return blocked;
    salePayments(input.payments, { currency: "MXN", minorUnits: paid });
    return {
      kind: "recover",
      tenantId: tenant.data,
      command: parsed.data,
      method:
        parsed.data.payments.length === 2
          ? "mixed"
          : (parsed.data.payments[0]?.method ?? "cash"),
      cash: minorUnitsToDecimal(
        parsed.data.payments.find((p) => p.method === "cash")?.amount
          .minorUnits ?? "0",
      ),
    };
  } catch {
    return blocked;
  }
}

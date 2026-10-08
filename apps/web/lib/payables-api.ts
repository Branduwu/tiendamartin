import "server-only";
import { randomUUID } from "node:crypto";
import {
  ExpenseSchema,
  SupplierPaymentSchema,
  UuidSchema,
} from "@smartretail/contracts";
import { money, PayableConflictError } from "@smartretail/domain";
import {
  PermissionDeniedError,
  PurchasingNotFoundError,
} from "@smartretail/application";
import { verifiedUserId } from "./auth";
import { payablesForUser } from "./database";
import {
  reply,
  jsonBody,
  requireSameOrigin,
  InvalidInput,
  SameOriginError,
} from "./api";
export async function handlePayables(
  request: Request,
  operation:
    "list" | "detail" | "pay" | "expenses" | "create-expense" | "supplier",
  id?: string,
) {
  const correlation = randomUUID();
  try {
    const user = await verifiedUserId();
    if (!user) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success) throw new InvalidInput();
    if (id !== undefined && !UuidSchema.safeParse(id).success)
      throw new InvalidInput();
    const query = new URL(request.url).searchParams;
    for (const key of query.keys())
      if (
        !["supplierId", "before", "purchasesBefore"].includes(key) ||
        query.getAll(key).length !== 1 ||
        !UuidSchema.safeParse(query.get(key)).success
      )
        throw new InvalidInput();
    if (
      operation !== "list" &&
      operation !== "expenses" &&
      operation !== "detail" &&
      operation !== "supplier" &&
      query.size
    )
      throw new InvalidInput();
    if (operation !== "list" && query.has("supplierId"))
      throw new InvalidInput();
    if (operation !== "supplier" && query.has("purchasesBefore"))
      throw new InvalidInput();
    const repo = payablesForUser(user, tenant.data);
    if (operation === "list")
      return reply({
        payables: await repo.list(
          query.get("supplierId") ?? undefined,
          query.get("before") ?? undefined,
        ),
      });
    if (operation === "supplier" && id)
      return reply(
        await repo.supplierSummary(
          id,
          query.get("before") ?? undefined,
          query.get("purchasesBefore") ?? undefined,
        ),
      );
    if (operation === "detail" && id)
      return reply(await repo.read(id, query.get("before") ?? undefined));
    if (operation === "expenses")
      return reply({
        expenses: await repo.expenses(query.get("before") ?? undefined),
      });
    requireSameOrigin(request);
    const body = await jsonBody(request);
    if (operation === "pay" && id) {
      const parsed = SupplierPaymentSchema.safeParse(body);
      if (!parsed.success) throw new InvalidInput();
      const { amount, shiftId, ...rest } = parsed.data;
      return reply(
        await repo.pay(
          id,
          {
            ...rest,
            ...(shiftId === undefined ? {} : { shiftId }),
            amount: money(BigInt(amount.minorUnits)),
          },
          correlation,
        ),
      );
    }
    if (operation === "create-expense") {
      const parsed = ExpenseSchema.safeParse(body);
      if (!parsed.success) throw new InvalidInput();
      const { amount, shiftId, locationId, ...rest } = parsed.data;
      return reply(
        await repo.createExpense(
          {
            ...rest,
            ...(shiftId === undefined ? {} : { shiftId }),
            ...(locationId === undefined ? {} : { locationId }),
            amount: money(BigInt(amount.minorUnits)),
          },
          correlation,
        ),
      );
    }
    throw new InvalidInput();
  } catch (e: unknown) {
    if (e instanceof PermissionDeniedError || e instanceof SameOriginError)
      return reply({ error: "No tienes permiso para esta operación." }, 403);
    if (e instanceof PurchasingNotFoundError)
      return reply({ error: "Cuenta no disponible." }, 404);
    if (e instanceof PayableConflictError)
      return reply(
        {
          error:
            "El pago supera el saldo, falta efectivo o la operación está en conflicto.",
        },
        409,
      );
    if (
      e instanceof InvalidInput ||
      e instanceof TypeError ||
      e instanceof RangeError
    )
      return reply({ error: "Revisa los datos de la operación." }, 400);
    console.error("Financial operation failed", { correlationId: correlation });
    return reply(
      {
        error:
          "No pudimos confirmar la operación. Reintenta con el mismo identificador.",
      },
      500,
    );
  }
}

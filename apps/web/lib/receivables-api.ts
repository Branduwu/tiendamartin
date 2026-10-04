import "server-only";
import { randomUUID } from "node:crypto";
import {
  UuidSchema,
  ReceivablePaymentInputSchema,
} from "@smartretail/contracts";
import { ReceivableConflictError, money } from "@smartretail/domain";
import {
  PermissionDeniedError,
  SaleNotFoundError,
  CashStateConflictError,
} from "@smartretail/application";
import { verifiedUserId } from "./auth";
import { receivablesForUser } from "./database";
import {
  reply,
  jsonBody,
  requireSameOrigin,
  InvalidInput,
  SameOriginError,
} from "./api";
export async function handleReceivables(
  request: Request,
  operation: "list" | "read" | "pay" | "summary" | "payments",
  id?: string,
) {
  const correlation = randomUUID();
  try {
    const user = await verifiedUserId();
    if (!user) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success) throw new InvalidInput();
    const repo = receivablesForUser(user, tenant.data),
      q = new URL(request.url).searchParams;
    const cursor = q.has("before")
      ? UuidSchema.safeParse(q.get("before"))
      : undefined;
    if (cursor && !cursor.success) throw new InvalidInput();
    const before = cursor?.success ? cursor.data : undefined;
    if (operation === "list") {
      if (
        [...q.keys()].some((k) => !["customerId", "before"].includes(k)) ||
        q.getAll("customerId").length > 1 ||
        q.getAll("before").length > 1
      )
        throw new InvalidInput();
      const parsed = q.has("customerId")
        ? UuidSchema.safeParse(q.get("customerId"))
        : undefined;
      if (parsed && !parsed.success) throw new InvalidInput();
      const customer = parsed?.success ? parsed.data : undefined;
      const receivables = await repo.list(customer, before);
      return reply({
        receivables,
        nextCursor: receivables.length === 100 ? receivables.at(-1)?.id : null,
      });
    }
    const parsed = UuidSchema.safeParse(id);
    if (
      !parsed.success ||
      [...q.keys()].some((k) => k !== "before") ||
      q.getAll("before").length > 1 ||
      (["summary", "pay"].includes(operation) && q.size)
    )
      throw new InvalidInput();
    if (operation === "summary")
      return reply({ outstandingAmount: await repo.summary(parsed.data) });
    if (operation === "payments") {
      const payments = await repo.customerPayments(parsed.data, before);
      return reply({
        payments,
        nextCursor: payments.length === 100 ? payments.at(-1)?.id : null,
      });
    }
    if (operation === "read")
      return reply(await repo.read(parsed.data, before));
    requireSameOrigin(request);
    const input = ReceivablePaymentInputSchema.safeParse(
      await jsonBody(request),
    );
    if (!input.success) throw new InvalidInput();
    return reply(
      await repo.collect(
        parsed.data,
        { ...input.data, amount: money(BigInt(input.data.amount.minorUnits)) },
        correlation,
      ),
    );
  } catch (e) {
    if (e instanceof PermissionDeniedError || e instanceof SameOriginError)
      return reply({ error: "No tienes permiso para esta operación." }, 403);
    if (e instanceof SaleNotFoundError)
      return reply({ error: "No se encontró la cuenta o el cliente." }, 404);
    if (
      e instanceof ReceivableConflictError ||
      e instanceof CashStateConflictError
    )
      return reply(
        {
          error:
            "El saldo, abono o turno cambió. Revisa la cuenta antes de reintentar.",
        },
        409,
      );
    if (
      e instanceof InvalidInput ||
      e instanceof TypeError ||
      e instanceof RangeError
    )
      return reply({ error: "Revisa los datos del abono." }, 400);
    console.error(
      JSON.stringify({
        operation: "receivables." + operation,
        correlationId: correlation,
        outcome: "unexpected_error",
      }),
    );
    return reply({ error: "No pudimos completar la operación." }, 500);
  }
}

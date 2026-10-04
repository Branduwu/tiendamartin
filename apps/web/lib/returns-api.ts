import "server-only";
import { randomUUID } from "node:crypto";
import { CreateSaleReturnSchema, UuidSchema } from "@smartretail/contracts";
import { SaleReturnConflictError } from "@smartretail/domain";
import {
  PermissionDeniedError,
  SaleNotFoundError,
  CashStateConflictError,
  StockBalanceNotFoundError,
} from "@smartretail/application";
import { verifiedUserId } from "./auth";
import { returnsForUser } from "./database";
import { returnInput, returnedDto } from "./return-mapping";
import {
  InvalidInput,
  SameOriginError,
  requireSameOrigin,
  jsonBody,
  reply,
} from "./api";
export async function handleReturns(
  request: Request,
  sid: string,
  operation: "list" | "create",
) {
  const correlationId = randomUUID();
  let actor: string | null = null,
    tenantId: string | undefined;
  try {
    actor = await verifiedUserId();
    if (!actor) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id")),
      sale = UuidSchema.safeParse(sid);
    if (!tenant.success || !sale.success || new URL(request.url).search)
      throw new InvalidInput();
    tenantId = tenant.data;
    const repo = returnsForUser(actor, tenantId);
    if (operation === "list")
      return reply({
        returns: (await repo.listReturns(sale.data)).map(returnedDto),
        settlement: await repo.settlement(sale.data),
      });
    requireSameOrigin(request);
    const parsed = CreateSaleReturnSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new InvalidInput();
    const result = await repo.returnSale(sale.data, {
      ...returnInput(parsed.data),
      correlationId,
    });
    console.info(
      JSON.stringify({
        operation: "sales.return",
        operationId: result.record.id,
        saleId: sale.data,
        userId: actor,
        tenantId,
        correlationId,
        at: new Date().toISOString(),
        replayed: result.replayed,
      }),
    );
    return reply(
      { record: returnedDto(result.record), replayed: result.replayed },
      result.replayed ? 200 : 201,
    );
  } catch (error) {
    if (
      error instanceof PermissionDeniedError ||
      error instanceof SameOriginError
    )
      return reply({ error: "No tienes permiso para esta devolución." }, 403);
    if (
      error instanceof SaleNotFoundError ||
      error instanceof StockBalanceNotFoundError
    )
      return reply(
        { error: "Venta o existencias originales no encontradas." },
        404,
      );
    if (error instanceof SaleReturnConflictError)
      return reply(
        {
          error:
            "La cantidad o el método exceden lo disponible, o el identificador ya tiene otro contenido.",
        },
        409,
      );
    if (error instanceof CashStateConflictError)
      return reply(
        {
          error:
            "El reembolso en efectivo requiere caja abierta en la ubicación original y efectivo suficiente.",
        },
        409,
      );
    if (
      error instanceof InvalidInput ||
      error instanceof TypeError ||
      error instanceof RangeError
    )
      return reply(
        {
          error:
            "Revisa cantidades y métodos. El reembolso debe coincidir exactamente con el cálculo histórico.",
        },
        400,
      );
    console.error(
      JSON.stringify({
        operation: "sales.return",
        correlationId,
        at: new Date().toISOString(),
        outcome: "unexpected_error",
      }),
    );
    return reply(
      {
        error:
          "No se pudo confirmar la devolución. Reintenta con el mismo identificador.",
        correlationId,
      },
      500,
    );
  }
}

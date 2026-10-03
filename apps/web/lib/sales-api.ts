import "server-only";
import { randomUUID } from "node:crypto";
import {
  CheckoutSchema,
  SaleIdSchema,
  UuidSchema,
} from "@smartretail/contracts";
import {
  completeSaleTransaction,
  readSale,
  PermissionDeniedError,
  ProductNotFoundError,
  StockBalanceNotFoundError,
  SaleQuoteChangedError,
  SaleIdempotencyConflictError,
  SaleNotFoundError,
  CashStateConflictError,
  SuspensionConflictError,
} from "@smartretail/application";
import {
  InsufficientStockError,
  IncompatibleQuantityUnitError,
} from "@smartretail/domain";
import { verifiedUserId } from "./auth";
import { salesForUser } from "./database";
import { checkoutInput, storedSaleDto } from "./sale-mapping";
import {
  InvalidInput,
  SameOriginError,
  jsonBody,
  requireSameOrigin,
  reply,
} from "./api";
export async function handleSales(
  request: Request,
  operation: "create" | "read" | "list",
  id?: string,
) {
  const correlationId = randomUUID();
  try {
    const userId = await verifiedUserId();
    if (!userId) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success) throw new InvalidInput();
    const repo = salesForUser(userId, tenant.data);
    if (operation === "list") {
      if (new URL(request.url).search)
        return reply({ error: "Consulta no soportada." }, 400);
      const sales = await repo.listSales();
      return reply({
        sales: sales.map(storedSaleDto),
        returnedSaleIds: await repo.returnedSaleIds(
          sales.map((s) => s.sale.id),
        ),
      });
    }
    if (operation === "read") {
      const parsed = SaleIdSchema.safeParse(id);
      if (!parsed.success) throw new InvalidInput();
      return reply({
        recorded: storedSaleDto(await readSale(repo, parsed.data)),
      });
    }
    requireSameOrigin(request);
    const parsed = CheckoutSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new InvalidInput();
    const result = await completeSaleTransaction(
      repo,
      checkoutInput(parsed.data),
    );
    console.info(
      JSON.stringify({
        operation: "sales.create",
        operationId: result.recorded.sale.id,
        tenantId: tenant.data,
        userId,
        correlationId,
        at: new Date().toISOString(),
        replayed: result.replayed,
      }),
    );
    return reply(
      { recorded: storedSaleDto(result.recorded), replayed: result.replayed },
      result.replayed ? 200 : 201,
    );
  } catch (error) {
    if (
      error instanceof PermissionDeniedError ||
      error instanceof SameOriginError
    )
      return reply({ error: "No tienes permiso para esta operación." }, 403);
    if (
      error instanceof SaleNotFoundError ||
      error instanceof ProductNotFoundError ||
      error instanceof StockBalanceNotFoundError
    )
      return reply(
        { error: "Venta, producto o ubicación no encontrados." },
        404,
      );
    if (error instanceof SuspensionConflictError)
      return reply(
        {
          error:
            "La venta suspendida ya fue completada, cancelada o pertenece a otra ubicaci\u00f3n.",
        },
        409,
      );
    if (error instanceof CashStateConflictError)
      return reply(
        {
          error:
            "Abre la caja de esta ubicaci�n antes de vender. El turno seleccionado debe seguir abierto.",
        },
        409,
      );
    if (error instanceof SaleIdempotencyConflictError)
      return reply(
        {
          error: "El identificador de venta ya está asociado a otro contenido.",
        },
        409,
      );
    if (error instanceof SaleQuoteChangedError)
      return reply(
        {
          error: "El producto cambió. Actualiza el carrito antes de completar.",
        },
        409,
      );
    if (error instanceof InsufficientStockError)
      return reply(
        { error: "Stock insuficiente. Revisa las cantidades del carrito." },
        409,
      );
    if (
      error instanceof InvalidInput ||
      error instanceof TypeError ||
      error instanceof RangeError ||
      error instanceof IncompatibleQuantityUnitError
    )
      return reply(
        {
          error:
            "Revisa productos, cantidades y pagos. Los pagos deben cubrir exactamente el total.",
        },
        400,
      );
    console.error(
      JSON.stringify({
        operation: "sales.create",
        correlationId,
        at: new Date().toISOString(),
        outcome: "unexpected_error",
      }),
    );
    return reply(
      {
        error:
          "No se pudo confirmar la venta. Reintenta con el mismo identificador.",
        correlationId,
      },
      500,
    );
  }
}

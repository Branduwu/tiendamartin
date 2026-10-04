import "server-only";
import { randomUUID } from "node:crypto";
import {
  CheckoutSchema,
  SaleIdSchema,
  UuidSchema,
  SaleQuoteSchema,
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
  CustomerUnavailableError,
  CashStateConflictError,
  SuspensionConflictError,
} from "@smartretail/application";
import {
  InsufficientStockError,
  IncompatibleQuantityUnitError,
  DiscountLimitError,
  DiscountUnavailableError,
  TaxProfileUnavailableError,
} from "@smartretail/domain";
import { verifiedUserId } from "./auth";
import { salesForUser } from "./database";
import { checkoutInput, storedSaleDto, completedSaleDto } from "./sale-mapping";
import {
  InvalidInput,
  SameOriginError,
  jsonBody,
  requireSameOrigin,
  reply,
} from "./api";
export async function handleSales(
  request: Request,
  operation: "create" | "read" | "list" | "quote",
  id?: string,
) {
  const correlationId = randomUUID();
  try {
    const userId = await verifiedUserId();
    if (!userId) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success) throw new InvalidInput();
    const repo = salesForUser(userId, tenant.data);
    if (operation === "quote") {
      requireSameOrigin(request);
      const value = SaleQuoteSchema.safeParse(await jsonBody(request));
      if (!value.success) throw new InvalidInput();
      const quoted = await repo.quoteSale(
        checkoutInput({ ...value.data, payments: [], movements: [] }),
      );
      return reply({
        sale: completedSaleDto(quoted.sale),
        taxes: quoted.sale.lines.flatMap((l) =>
          l.tax
            ? [
                {
                  productId: l.productId,
                  profileId: l.tax.profileId,
                  rate: l.tax.rate.toString(),
                },
              ]
            : [],
        ),
        ...(quoted.details === undefined ? {} : { details: quoted.details }),
      });
    }
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
    if (error instanceof TaxProfileUnavailableError)
      return reply(
        {
          error:
            "El impuesto asignado está inactivo. Solicita revisar el producto antes de vender.",
        },
        409,
      );
    if (error instanceof DiscountLimitError)
      return reply(
        { error: "El descuento manual del cajero no puede superar el 20%." },
        403,
      );
    if (error instanceof DiscountUnavailableError)
      return reply(
        { error: "Cupón inválido, inactivo, expirado o agotado." },
        409,
      );
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
    if (error instanceof CustomerUnavailableError)
      return reply(
        {
          error:
            "El cliente no existe, está inactivo o no pertenece a esta empresa. Quita la selección o elige otro cliente.",
        },
        409,
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
          error:
            "El precio o descuento cambió. Actualiza la cotización antes de completar.",
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

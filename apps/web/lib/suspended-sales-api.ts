import "server-only";
import { randomUUID } from "node:crypto";
import {
  UuidSchema,
  BarcodeSchema,
  SuspendSaleSchema,
  RecoverSuspendedSaleSchema,
  CancelSuspendedSaleSchema,
  type SuspendedSaleDto,
} from "@smartretail/contracts";
import { quantity } from "@smartretail/domain";
import {
  PermissionDeniedError,
  SuspensionConflictError,
  SuspensionNotFoundError,
  ProductNotFoundError,
  StockBalanceNotFoundError,
  type SuspendedSale,
} from "@smartretail/application";
import { verifiedUserId } from "./auth";
import { suspendedSalesForUser } from "./database";
import { productDto } from "./product-mapping";
import {
  InvalidInput,
  SameOriginError,
  requireSameOrigin,
  jsonBody,
  reply,
} from "./api";

function recordDto(record: SuspendedSale): SuspendedSaleDto {
  return {
    ...record,
    lines: record.lines.map((l) => ({
      productId: l.productId,
      quantity: {
        unit: l.quantity.unit,
        milliUnits: l.quantity.milliUnits.toString(),
      },
    })),
  };
}
export async function handleSuspendedSales(
  request: Request,
  operation: "barcode" | "suspend" | "list" | "recover" | "cancel",
  id?: string,
) {
  const correlationId = randomUUID();
  let actor: string | null = null,
    tenantId: string | undefined;
  try {
    actor = await verifiedUserId();
    if (!actor) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success) throw new InvalidInput();
    tenantId = tenant.data;
    const repo = suspendedSalesForUser(actor, tenantId);
    const url = new URL(request.url);
    if (operation === "barcode") {
      const keys = [...url.searchParams.keys()];
      const code = BarcodeSchema.safeParse(url.searchParams.get("barcode"));
      if (!code.success || keys.length !== 1 || keys[0] !== "barcode")
        throw new InvalidInput();
      const product = await repo.lookupBarcode(code.data);
      return reply(
        product
          ? { status: product.status, product: productDto(product) }
          : { status: "not_found" },
      );
    }
    if (url.search) throw new InvalidInput();
    if (operation === "list")
      return reply({ suspended: (await repo.listSuspended()).map(recordDto) });
    requireSameOrigin(request);
    let response;
    if (operation === "suspend") {
      const parsed = SuspendSaleSchema.safeParse(await jsonBody(request));
      if (!parsed.success) throw new InvalidInput();
      const result = await repo.suspend({
        ...parsed.data,
        lines: parsed.data.lines.map((l) => ({
          productId: l.productId,
          quantity: quantity(l.quantity.unit, BigInt(l.quantity.milliUnits)),
        })),
      });
      response = reply(
        { record: recordDto(result.record), replayed: result.replayed },
        result.replayed ? 200 : 201,
      );
    } else {
      const parsedId = UuidSchema.safeParse(id);
      if (!parsedId.success) throw new InvalidInput();
      if (operation === "cancel") {
        if (
          !CancelSuspendedSaleSchema.safeParse(await jsonBody(request)).success
        )
          throw new InvalidInput();
        response = reply({
          record: recordDto(await repo.cancelSuspended(parsedId.data)),
        });
      } else {
        const body = RecoverSuspendedSaleSchema.safeParse(
          await jsonBody(request),
        );
        if (!body.success) throw new InvalidInput();
        const result = await repo.recoverSuspended(
          parsedId.data,
          body.data.saleId,
        );
        // Transport exact bigint values as strings; current server quote only.
        const draft = {
          ...result.draft,
          total: {
            currency: "MXN",
            minorUnits: result.draft.total.minorUnits.toString(),
          },
          lines: result.draft.lines.map((l) => ({
            ...l,
            quantity: {
              unit: l.unit,
              milliUnits: l.quantity.milliUnits.toString(),
            },
            unitPrice: {
              currency: "MXN",
              minorUnits: l.unitPrice.minorUnits.toString(),
            },
            lineTotal: {
              currency: "MXN",
              minorUnits: l.lineTotal.minorUnits.toString(),
            },
          })),
        };
        response = reply({ record: recordDto(result.record), draft });
      }
    }
    console.info(
      JSON.stringify({
        operation: `sales.${operation}`,
        operationId: id,
        actor,
        tenantId,
        correlationId,
        at: new Date().toISOString(),
      }),
    );
    return response;
  } catch (error) {
    if (
      error instanceof PermissionDeniedError ||
      error instanceof SameOriginError
    )
      return reply({ error: "No tienes permiso para esta operación." }, 403);
    if (
      error instanceof SuspensionNotFoundError ||
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
            "La suspendida no está disponible o un producto cambió de unidad/estado. Conservamos el registro; revisa los productos.",
        },
        409,
      );
    if (
      error instanceof InvalidInput ||
      error instanceof TypeError ||
      error instanceof RangeError
    )
      return reply(
        { error: "Revisa el código, la ubicación y las cantidades." },
        400,
      );
    console.error(
      JSON.stringify({
        operation: `sales.${operation}`,
        correlationId,
        at: new Date().toISOString(),
        outcome: "unexpected_error",
      }),
    );
    return reply(
      {
        error:
          "No se pudo confirmar la operación. Reintenta con el mismo identificador.",
        correlationId,
      },
      500,
    );
  }
}

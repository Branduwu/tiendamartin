import "server-only";
import { randomUUID } from "node:crypto";
import {
  CreateSupplierSchema,
  UpdateSupplierSchema,
  CreatePurchaseOrderSchema,
  UpdatePurchaseOrderSchema,
  ReceivePurchaseOrderSchema,
  PurchaseActionSchema,
  UuidSchema,
} from "@smartretail/contracts";
import {
  money,
  quantity,
  productId,
  PurchaseConflictError,
  type PurchaseOrder,
  type PurchaseDraftInput,
} from "@smartretail/domain";
import {
  PermissionDeniedError,
  PurchasingNotFoundError,
  createSupplier,
  createPurchaseOrder,
  receivePurchaseOrder,
} from "@smartretail/application";
import { verifiedUserId } from "./auth";
import { purchasingForUser } from "./database";
import {
  reply,
  jsonBody,
  requireSameOrigin,
  InvalidInput,
  SameOriginError,
} from "./api";

export function purchaseDto(p: PurchaseOrder) {
  return {
    ...p,
    lines: p.lines.map((l) => ({
      ...l,
      quantityOrdered: {
        ...l.quantityOrdered,
        milliUnits: l.quantityOrdered.milliUnits.toString(),
      },
      quantityReceived: {
        ...l.quantityReceived,
        milliUnits: l.quantityReceived.milliUnits.toString(),
      },
      unitCost: { ...l.unitCost, minorUnits: l.unitCost.minorUnits.toString() },
    })),
  };
}
function draft(
  value: ReturnType<typeof CreatePurchaseOrderSchema.parse>,
): PurchaseDraftInput {
  return {
    id: value.id,
    supplierId: value.supplierId,
    locationId: value.locationId,
    ...(value.notes === undefined ? {} : { notes: value.notes }),
    lines: value.lines.map((l) => ({
      productId: productId(l.productId),
      quantityOrdered: quantity(
        l.quantityOrdered.unit,
        BigInt(l.quantityOrdered.milliUnits),
      ),
      unitCost: money(BigInt(l.unitCost.minorUnits)),
    })),
  };
}
export type PurchasingOperation =
  | "suppliers"
  | "create-supplier"
  | "update-supplier"
  | "purchases"
  | "create-purchase"
  | "purchase"
  | "update-purchase"
  | "order"
  | "cancel"
  | "receive";
export async function handlePurchasing(
  request: Request,
  operation: PurchasingOperation,
  id?: string,
) {
  const correlationId = randomUUID();
  try {
    const userId = await verifiedUserId();
    if (!userId) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success) throw new InvalidInput();
    if (new URL(request.url).search) throw new InvalidInput();
    const repo = purchasingForUser(userId, tenant.data, correlationId);
    if (operation === "suppliers")
      return reply({ suppliers: await repo.listSuppliers() });
    if (operation === "purchases")
      return reply({
        purchases: (await repo.listPurchases()).map(purchaseDto),
      });
    const parsedId = id === undefined ? undefined : UuidSchema.safeParse(id);
    if (parsedId && !parsedId.success) throw new InvalidInput();
    if (operation === "purchase") {
      if (!parsedId?.success) throw new InvalidInput();
      return reply({
        purchase: purchaseDto(await repo.readPurchase(parsedId.data)),
      });
    }
    requireSameOrigin(request);
    const body = await jsonBody(request);
    if (operation === "create-supplier") {
      const result = CreateSupplierSchema.safeParse(body);
      if (!result.success) throw new InvalidInput();
      const { id: createdId, ...fields } = result.data;
      return reply(
        {
          supplier: await createSupplier(repo, createdId, {
            name: fields.name,
            status: fields.status,
            ...(fields.contactName === undefined
              ? {}
              : { contactName: fields.contactName }),
            ...(fields.phone === undefined ? {} : { phone: fields.phone }),
            ...(fields.email === undefined ? {} : { email: fields.email }),
            ...(fields.notes === undefined ? {} : { notes: fields.notes }),
          }),
        },
        201,
      );
    }
    if (operation === "update-supplier") {
      const result = UpdateSupplierSchema.safeParse(body);
      if (!result.success || !parsedId?.success) throw new InvalidInput();
      const fields = result.data;
      return reply({
        supplier: await repo.updateSupplier(parsedId.data, {
          ...(fields.name === undefined ? {} : { name: fields.name }),
          ...(fields.status === undefined ? {} : { status: fields.status }),
          ...(fields.contactName === undefined
            ? {}
            : { contactName: fields.contactName }),
          ...(fields.phone === undefined ? {} : { phone: fields.phone }),
          ...(fields.email === undefined ? {} : { email: fields.email }),
          ...(fields.notes === undefined ? {} : { notes: fields.notes }),
        }),
      });
    }
    if (operation === "create-purchase") {
      const result = CreatePurchaseOrderSchema.safeParse(body);
      if (!result.success) throw new InvalidInput();
      return reply(
        {
          purchase: purchaseDto(
            await createPurchaseOrder(repo, draft(result.data)),
          ),
        },
        201,
      );
    }
    if (!parsedId?.success) throw new InvalidInput();
    if (operation === "update-purchase") {
      const result = UpdatePurchaseOrderSchema.safeParse(body);
      if (!result.success) throw new InvalidInput();
      return reply({
        purchase: purchaseDto(
          await repo.updatePurchase(
            draft({ ...result.data, id: parsedId.data }),
          ),
        ),
      });
    }
    if (operation === "receive") {
      const result = ReceivePurchaseOrderSchema.safeParse(body);
      if (!result.success) throw new InvalidInput();
      const received = await receivePurchaseOrder(repo, parsedId.data, {
        id: result.data.id,
        lines: result.data.lines.map((l) => ({
          productId: productId(l.productId),
          quantity: quantity(l.quantity.unit, BigInt(l.quantity.milliUnits)),
        })),
      });
      return reply({
        purchase: purchaseDto(received.order),
        replayed: received.replayed,
      });
    }
    if (!PurchaseActionSchema.safeParse(body).success) throw new InvalidInput();
    if (operation !== "order" && operation !== "cancel")
      throw new InvalidInput();
    return reply({
      purchase: purchaseDto(
        await repo.changePurchase(parsedId.data, operation),
      ),
    });
  } catch (error) {
    if (
      error instanceof PermissionDeniedError ||
      error instanceof SameOriginError
    )
      return reply({ error: "No tienes permiso para esta operación." }, 403);
    if (
      error instanceof InvalidInput ||
      error instanceof TypeError ||
      error instanceof RangeError
    )
      return reply(
        { error: "Revisa los campos, costos, unidades y cantidades." },
        400,
      );
    if (error instanceof PurchasingNotFoundError)
      return reply({ error: "No se encontró el proveedor o la orden." }, 404);
    if (error instanceof PurchaseConflictError)
      return reply(
        {
          error:
            "La orden o el ID de recepción entran en conflicto. Revisa el estado y las cantidades pendientes.",
        },
        409,
      );
    console.error(
      JSON.stringify({
        operation: `purchasing.${operation}`,
        correlationId,
        outcome: "unexpected_error",
        at: new Date().toISOString(),
      }),
    );
    return reply(
      {
        error: "No pudimos confirmar la operación. Reintenta el mismo comando.",
        correlationId,
      },
      500,
    );
  }
}

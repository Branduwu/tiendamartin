import "server-only";
import { randomUUID } from "node:crypto";
import {
  InventoryAlertQuerySchema,
  SetInventoryMinimumSchema,
  UuidSchema,
  type InventoryPrefillDto,
} from "@smartretail/contracts";
import {
  PermissionDeniedError,
  setInventoryMinimum,
  type InventoryAlert,
  type InventoryMinimumRepository,
} from "@smartretail/application";
import { quantity } from "@smartretail/domain";
import { verifiedUserId } from "./auth";
import { inventoryMinimumForUser, reportingForUser } from "./database";
import {
  InvalidInput,
  SameOriginError,
  jsonBody,
  reply,
  requireSameOrigin,
} from "./api";

type Operation = "minimums" | "alerts" | "replenishment";
type Dependencies = {
  verifiedUserId: () => Promise<string | null>;
  minimumForUser: (
    userId: string,
    tenantId: string,
    correlationId: string,
  ) => InventoryMinimumRepository;
  reportingForUser: (
    userId: string,
    tenantId: string,
  ) => {
    inventoryAlerts: (
      locationId?: string,
      productId?: string,
    ) => Promise<{
      low: string;
      empty: string;
      alerts: readonly InventoryAlert[];
    }>;
    replenishment: (
      productId: string,
      locationId: string,
    ) => Promise<InventoryPrefillDto>;
  };
};

/** Repositories enforce membership, permissions and related resource tenancy. */
export function createInventoryMinimumHandler(dependencies: Dependencies) {
  return async (request: Request, operation: Operation) => {
    const correlationId = randomUUID();
    try {
      const userId = await dependencies.verifiedUserId();
      if (!userId)
        return reply({ error: "Inicia sesión para continuar." }, 401);
      const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
      if (!tenant.success) throw new InvalidInput();
      const params = new URL(request.url).searchParams;
      if (operation === "minimums") {
        if (params.size) throw new InvalidInput();
        requireSameOrigin(request);
        const parsed = SetInventoryMinimumSchema.safeParse(
          await jsonBody(request),
        );
        if (!parsed.success) throw new InvalidInput();
        const { productId, locationId, minimumStock } = parsed.data;
        await setInventoryMinimum(
          dependencies.minimumForUser(userId, tenant.data, correlationId),
          productId,
          locationId,
          minimumStock === null
            ? null
            : quantity(minimumStock.unit, BigInt(minimumStock.milliUnits)),
        );
        console.info(
          JSON.stringify({
            operation: "inventory.minimum.write",
            userId,
            tenantId: tenant.data,
            productId,
            locationId,
            correlationId,
            at: new Date().toISOString(),
          }),
        );
        return reply({ productId, locationId, minimumStock });
      }
      if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
        throw new InvalidInput();
      const parsed = InventoryAlertQuerySchema.safeParse(
        Object.fromEntries(params),
      );
      if (!parsed.success) throw new InvalidInput();
      const { productId, locationId } = parsed.data;
      if (operation === "replenishment" && (!productId || !locationId))
        throw new InvalidInput();
      const repo = dependencies.reportingForUser(userId, tenant.data);
      if (operation === "alerts")
        return reply(await repo.inventoryAlerts(locationId, productId));
      // Replenishment is a read-only prefill; the repository requires both
      // inventory.read and purchases.write and never creates a purchase order.
      if (!productId || !locationId) throw new InvalidInput();
      return reply(await repo.replenishment(productId, locationId));
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
          { error: "Revisa el producto, la ubicación y la cantidad." },
          400,
        );
      console.error(
        JSON.stringify({
          operation: `inventory.${operation}`,
          correlationId,
          outcome: "unexpected_error",
          at: new Date().toISOString(),
        }),
      );
      return reply(
        {
          error: "No pudimos completar la operación. Reintenta.",
          correlationId,
        },
        500,
      );
    }
  };
}

export const handleInventoryMinimum = createInventoryMinimumHandler({
  verifiedUserId,
  minimumForUser: inventoryMinimumForUser,
  reportingForUser,
});

import "server-only";
import { randomUUID } from "node:crypto";
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  CustomerSearchSchema,
  UuidSchema,
} from "@smartretail/contracts";
import {
  CustomerNotFoundError,
  PermissionDeniedError,
} from "@smartretail/application";
import { DatabaseUniquenessConflictError } from "@smartretail/database";
import { verifiedUserId } from "./auth";
import { customersForUser } from "./database";
import {
  InvalidInput,
  SameOriginError,
  reply,
  jsonBody,
  requireSameOrigin,
} from "./api";
export async function handleCustomers(
  request: Request,
  operation: "list" | "create" | "read" | "update",
  id?: string,
) {
  const correlationId = randomUUID();
  try {
    const userId = await verifiedUserId();
    if (!userId) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success) throw new InvalidInput();
    const repo = customersForUser(userId, tenant.data, correlationId),
      query = new URL(request.url).searchParams;
    if (operation === "list") {
      if (
        [...query.keys()].some((k) => k !== "q") ||
        query.getAll("q").length > 1
      )
        throw new InvalidInput();
      const search = CustomerSearchSchema.safeParse(query.get("q") ?? "");
      if (!search.success) throw new InvalidInput();
      return reply({ customers: await repo.listCustomers(search.data) });
    }
    if (query.size) throw new InvalidInput();
    const valid = id === undefined ? undefined : UuidSchema.safeParse(id);
    if (valid && !valid.success) throw new InvalidInput();
    if (operation === "read") {
      if (!valid?.success) throw new InvalidInput();
      const detail = await repo.readCustomer(valid.data);
      return reply({
        customer: detail.customer,
        sales: detail.sales.map((s) => ({
          ...s,
          total: { currency: "MXN", minorUnits: s.total.minorUnits.toString() },
          returnedTotal: {
            currency: "MXN",
            minorUnits: s.returnedTotal.minorUnits.toString(),
          },
        })),
      });
    }
    requireSameOrigin(request);
    const body = await jsonBody(request);
    if (operation === "create") {
      const value = CreateCustomerSchema.safeParse(body);
      if (!value.success) throw new InvalidInput();
      const { id: createdId, ...fields } = value.data;
      return reply(
        { customer: await repo.createCustomer(createdId, fields) },
        201,
      );
    }
    const value = UpdateCustomerSchema.safeParse(body);
    if (!value.success || !valid?.success) throw new InvalidInput();
    return reply({
      customer: await repo.updateCustomer(valid.data, value.data),
    });
  } catch (e) {
    if (e instanceof PermissionDeniedError || e instanceof SameOriginError)
      return reply({ error: "No tienes permiso para esta operación." }, 403);
    if (
      e instanceof InvalidInput ||
      e instanceof TypeError ||
      e instanceof RangeError
    )
      return reply({ error: "Revisa los datos del cliente." }, 400);
    if (e instanceof CustomerNotFoundError)
      return reply({ error: "No se encontró el cliente." }, 404);
    if (e instanceof DatabaseUniquenessConflictError)
      return reply({ error: "El identificador ya está registrado." }, 409);
    console.error(
      JSON.stringify({
        operation: "customers." + operation,
        correlationId,
        outcome: "unexpected_error",
        at: new Date().toISOString(),
      }),
    );
    return reply(
      { error: "No pudimos completar la operación. Reintenta." },
      500,
    );
  }
}

import "server-only";
import { randomUUID } from "node:crypto";
import {
  UuidSchema,
  TaxProfileInputSchema,
  TaxProfileFieldsSchema,
} from "@smartretail/contracts";
import { PermissionDeniedError } from "@smartretail/application";
import { TaxProfileNotFoundError } from "@smartretail/database";
import { verifiedUserId } from "./auth";
import { taxesForUser } from "./database";
import {
  InvalidInput,
  SameOriginError,
  requireSameOrigin,
  jsonBody,
  reply,
} from "./api";
export async function handleTaxes(
  request: Request,
  operation: "list" | "create" | "update",
  id?: string,
) {
  const correlationId = randomUUID();
  try {
    const userId = await verifiedUserId();
    if (!userId) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success || new URL(request.url).search)
      throw new InvalidInput();
    const repo = taxesForUser(userId, tenant.data);
    if (operation === "list")
      return reply({ profiles: await repo.listTaxProfiles() });
    requireSameOrigin(request);
    await repo.authorize("taxes.manage");
    const update = operation === "update";
    if (update && !UuidSchema.safeParse(id).success) throw new InvalidInput();
    const body = await jsonBody(request);
    const parsed = update
      ? TaxProfileFieldsSchema.safeParse(body)
      : TaxProfileInputSchema.safeParse(body);
    if (!parsed.success) throw new InvalidInput();
    const profile = await repo.saveTaxProfile(
      {
        ...parsed.data,
        id: update ? id! : "id" in parsed.data ? String(parsed.data.id) : "",
      },
      update,
      correlationId,
    );
    return reply({ profile }, update ? 200 : 201);
  } catch (e) {
    if (e instanceof PermissionDeniedError || e instanceof SameOriginError)
      return reply(
        { error: "No tienes permiso para administrar impuestos." },
        403,
      );
    if (e instanceof TaxProfileNotFoundError)
      return reply({ error: "Perfil de impuesto no encontrado." }, 404);
    if (
      e instanceof InvalidInput ||
      e instanceof TypeError ||
      e instanceof RangeError
    )
      return reply(
        { error: "Revisa nombre, tasa y estado del impuesto." },
        400,
      );
    console.error(
      JSON.stringify({
        operation: "taxes." + operation,
        correlationId,
        outcome: "unexpected_error",
      }),
    );
    return reply(
      { error: "No pudimos completar la operación.", correlationId },
      500,
    );
  }
}

import "server-only";
import { randomUUID } from "node:crypto";
import { UpdateMemberSchema, UuidSchema } from "@smartretail/contracts";
import { PermissionDeniedError } from "@smartretail/application";
import {
  MemberNotFoundError,
  MemberStateConflictError,
} from "@smartretail/database";
import { verifiedUserId } from "./auth";
import { membersForUser, inventoryForUser } from "./database";
import {
  InvalidInput,
  SameOriginError,
  reply,
  jsonBody,
  requireSameOrigin,
} from "./api";

export async function handleMembers(
  request: Request,
  operation: "list" | "update",
  id?: string,
) {
  const correlationId = randomUUID();
  try {
    const userId = await verifiedUserId();
    if (!userId) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success || new URL(request.url).searchParams.size)
      throw new InvalidInput();
    const repo = membersForUser(userId, tenant.data, correlationId);
    if (operation === "list") {
      // Check members.manage before requesting any location data.
      const members = await repo.listMembers();
      const locations = await inventoryForUser(
        userId,
        tenant.data,
      ).listLocations();
      return reply({ members, locations });
    }
    requireSameOrigin(request);
    const target = UuidSchema.safeParse(id);
    const value = UpdateMemberSchema.safeParse(await jsonBody(request));
    if (!target.success || !value.success) throw new InvalidInput();
    return reply({ member: await repo.updateMember(target.data, value.data) });
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
      return reply({ error: "Revisa los datos del usuario." }, 400);
    if (error instanceof MemberNotFoundError)
      return reply({ error: "No se encontró el usuario." }, 404);
    if (error instanceof MemberStateConflictError)
      return reply(
        { error: "No se puede aplicar este cambio al usuario." },
        409,
      );
    console.error(
      JSON.stringify({
        operation: "members." + operation,
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

import "server-only";
import { randomUUID } from "node:crypto";
import {
  BusinessProfileSchema,
  BranchSettingsSchema,
  UuidSchema,
} from "@smartretail/contracts";
import {
  PermissionDeniedError,
  BusinessSettingsNotFoundError,
} from "@smartretail/application";
import { businessForUser } from "./database";
import { verifiedUserId } from "./auth";
import {
  reply,
  jsonBody,
  requireSameOrigin,
  InvalidInput,
  SameOriginError,
} from "./api";
export async function handleBusiness(
  request: Request,
  operation: "read" | "save" | "branch",
  id?: string,
) {
  const correlation = randomUUID();
  try {
    const user = await verifiedUserId();
    if (!user) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success || new URL(request.url).searchParams.size)
      throw new InvalidInput();
    const repo = businessForUser(user, tenant.data);
    if (operation === "read") return reply(await repo.read());
    requireSameOrigin(request);
    const body = await jsonBody(request);
    if (operation === "save") {
      const parsed = BusinessProfileSchema.safeParse(body);
      if (!parsed.success) throw new InvalidInput();
      return reply(await repo.save(parsed.data, correlation));
    }
    const branch = UuidSchema.safeParse(id),
      parsed = BranchSettingsSchema.safeParse(body);
    if (!branch.success || !parsed.success) throw new InvalidInput();
    return reply(await repo.saveBranch(branch.data, parsed.data, correlation));
  } catch (e) {
    if (e instanceof PermissionDeniedError || e instanceof SameOriginError)
      return reply(
        { error: "No tienes permiso para esta configuración." },
        403,
      );
    if (e instanceof BusinessSettingsNotFoundError)
      return reply({ error: "Sucursal no disponible." }, 404);
    if (
      e instanceof InvalidInput ||
      e instanceof TypeError ||
      e instanceof RangeError
    )
      return reply({ error: "Revisa los datos de configuración." }, 400);
    console.error("Business settings failed", { correlationId: correlation });
    return reply(
      { error: "No pudimos guardar o consultar la configuración." },
      500,
    );
  }
}

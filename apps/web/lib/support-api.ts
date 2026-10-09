import "server-only";
import { randomUUID } from "node:crypto";
import {
  CreateSupportRequestSchema,
  UpdateSupportStatusSchema,
  SupportListQuerySchema,
  UuidSchema,
} from "@smartretail/contracts";
import {
  PermissionDeniedError,
  SupportUnavailableError,
  SupportConflictError,
  SupportRateLimitError,
} from "@smartretail/application";
import { verifiedUserId } from "./auth";
import { supportForUser, platformForUser } from "./database";
import {
  reply,
  jsonBody,
  requireSameOrigin,
  InvalidInput,
  SameOriginError,
} from "./api";
export async function handleSupport(
  request: Request,
  operation: "list" | "create" | "detail" | "status" | "setup",
  id?: string,
  platform = false,
) {
  const correlation = randomUUID();
  try {
    const actor = await verifiedUserId();
    if (!actor) return reply({ error: "Inicia sesión para continuar." }, 401);
    let tenant: string | undefined;
    if (platform) {
      if (!(await platformForUser(actor).access()))
        throw new PermissionDeniedError();
    } else {
      const p = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
      if (!p.success) throw new InvalidInput();
      tenant = p.data;
    }
    const repo = supportForUser(actor, tenant, platform);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((k) => params.getAll(k).length !== 1))
      throw new InvalidInput();
    if (operation === "list") {
      const p = SupportListQuerySchema.safeParse(Object.fromEntries(params));
      if (!p.success) throw new InvalidInput();
      return reply(await repo.list(Number(p.data.page), p.data.status));
    }
    if (params.size) throw new InvalidInput();
    if (operation === "setup") return reply(await repo.initialSetup());
    if (operation === "detail") {
      const p = UuidSchema.safeParse(id);
      if (!p.success) throw new InvalidInput();
      return reply(await repo.detail(p.data));
    }
    requireSameOrigin(request);
    const body = await jsonBody(request);
    if (operation === "create" && !platform) {
      const p = CreateSupportRequestSchema.safeParse(body);
      if (!p.success) throw new InvalidInput();
      return reply(await repo.create(p.data, correlation), 201);
    }
    if (operation !== "status" || !platform) throw new PermissionDeniedError();
    const p = UpdateSupportStatusSchema.safeParse(body),
      key = UuidSchema.safeParse(id);
    if (!p.success || !key.success) throw new InvalidInput();
    return reply(await repo.changeStatus(key.data, p.data.status, correlation));
  } catch (e) {
    if (e instanceof PermissionDeniedError || e instanceof SameOriginError)
      return reply(
        { error: "No tienes acceso a esta solicitud o empresa." },
        403,
      );
    if (e instanceof SupportUnavailableError)
      return reply({ error: "Solicitud no disponible." }, 404);
    if (e instanceof SupportConflictError)
      return reply(
        {
          error:
            "Esta solicitud ya se envió con otros datos. Revisa Mis solicitudes.",
        },
        409,
      );
    if (e instanceof SupportRateLimitError)
      return reply(
        {
          error:
            "Alcanzaste el límite de solicitudes por hora. Revisa las existentes o intenta más tarde.",
        },
        429,
      );
    if (
      e instanceof InvalidInput ||
      e instanceof TypeError ||
      e instanceof RangeError
    )
      return reply({ error: "Revisa los datos de tu solicitud." }, 400);
    console.error("Support operation failed", { correlationId: correlation });
    return reply(
      {
        error:
          "No pudimos confirmar la operación. Reintenta la misma solicitud.",
      },
      500,
    );
  }
}

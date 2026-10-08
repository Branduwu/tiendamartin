import "server-only";
import { randomUUID } from "node:crypto";
import {
  CreateCompanySchema,
  CompanyStatusSchema,
  PlatformPageSchema,
  PlatformUsersQuerySchema,
  UuidSchema,
} from "@smartretail/contracts";
import {
  PermissionDeniedError,
  PlatformCompanyNotFoundError,
  PlatformCompanyConflictError,
} from "@smartretail/application";
import { verifiedUserId } from "./auth";
import { platformForUser } from "./database";
import {
  reply,
  jsonBody,
  requireSameOrigin,
  InvalidInput,
  SameOriginError,
} from "./api";
export async function handlePlatform(
  request: Request,
  operation: "access" | "list" | "detail" | "users" | "create" | "status",
  id?: string,
) {
  const correlation = randomUUID();
  try {
    const actor = await verifiedUserId();
    if (!actor) return reply({ error: "Inicia sesión para continuar." }, 401);
    const repo = platformForUser(actor);
    if (!(await repo.access())) throw new PermissionDeniedError();
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((k) => params.getAll(k).length !== 1))
      throw new InvalidInput();
    if (operation === "access") {
      if (params.size) throw new InvalidInput();
      return reply({ allowed: true });
    }
    if (operation === "list") {
      const p = PlatformPageSchema.safeParse(Object.fromEntries(params));
      if (!p.success) throw new InvalidInput();
      return reply(await repo.list(Number(p.data.page)));
    }
    if (operation === "users") {
      const p = PlatformUsersQuerySchema.safeParse(Object.fromEntries(params));
      if (!p.success) throw new InvalidInput();
      return reply({
        users: await repo.users(p.data.search, Number(p.data.page)),
      });
    }
    if (params.size) throw new InvalidInput();
    if (operation === "detail") {
      const tid = UuidSchema.safeParse(id);
      if (!tid.success) throw new InvalidInput();
      return reply(await repo.detail(tid.data));
    }
    requireSameOrigin(request);
    const body = await jsonBody(request);
    if (operation === "create") {
      const p = CreateCompanySchema.safeParse(body);
      if (!p.success) throw new InvalidInput();
      return reply(await repo.create(p.data, correlation), 201);
    }
    const tid = UuidSchema.safeParse(id),
      p = CompanyStatusSchema.safeParse(body);
    if (!tid.success || !p.success) throw new InvalidInput();
    return reply(
      await repo.changeStatus(
        tid.data,
        p.data.status,
        correlation,
        p.data.commandId,
      ),
    );
  } catch (e) {
    if (e instanceof PermissionDeniedError || e instanceof SameOriginError)
      return reply(
        { error: "Acceso reservado a la administración de plataforma." },
        403,
      );
    if (e instanceof PlatformCompanyNotFoundError)
      return reply({ error: "Empresa no disponible." }, 404);
    if (e instanceof PlatformCompanyConflictError)
      return reply(
        {
          error:
            "Esta solicitud ya tiene otros datos. Revisa el listado de empresas.",
        },
        409,
      );
    if (
      e instanceof InvalidInput ||
      e instanceof TypeError ||
      e instanceof RangeError
    )
      return reply(
        { error: "Revisa los datos de la empresa o del propietario." },
        400,
      );
    console.error("Platform request failed", { correlationId: correlation });
    return reply(
      {
        error:
          "No pudimos confirmar la operación. Reintenta la misma solicitud.",
      },
      500,
    );
  }
}

import "server-only";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  OnboardingSchema,
  CreateInvitationSchema,
  AcceptInvitationSchema,
  UuidSchema,
} from "@smartretail/contracts";
import { PermissionDeniedError } from "@smartretail/application";
import {
  OnboardingConflictError,
  InvitationUnavailableError,
} from "@smartretail/database";
import { verifiedUserId } from "./auth";
import {
  onboardingForUser,
  tenantsForUser,
  inventoryForUser,
} from "./database";
import {
  reply,
  jsonBody,
  requireSameOrigin,
  InvalidInput,
  SameOriginError,
} from "./api";
export async function handleOnboarding(
  request: Request,
  operation: "status" | "onboard" | "list" | "create" | "revoke" | "accept",
  id?: string,
) {
  const correlation = randomUUID();
  try {
    const actor = await verifiedUserId();
    if (!actor) return reply({ error: "Inicia sesión para continuar." }, 401);
    if (new URL(request.url).searchParams.size) throw new InvalidInput();
    const repo = onboardingForUser(actor);
    if (operation === "status") {
      const tenants = await tenantsForUser(actor);
      return reply({ tenants, completed: tenants.length > 0 });
    }
    if (operation !== "list") requireSameOrigin(request);
    if (operation === "onboard") {
      const p = OnboardingSchema.safeParse(await jsonBody(request));
      if (!p.success) throw new InvalidInput();
      return reply(await repo.onboard(p.data, correlation), 201);
    }
    if (operation === "accept") {
      const p = AcceptInvitationSchema.safeParse(await jsonBody(request));
      if (!p.success) throw new InvalidInput();
      return reply(
        await repo.accept(
          createHash("sha256").update(p.data.token, "utf8").digest("hex"),
          correlation,
        ),
      );
    }
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success) throw new InvalidInput();
    if (operation === "list") {
      const invitations = await repo.list(tenant.data, correlation);
      const locations = await inventoryForUser(
        actor,
        tenant.data,
      ).listLocations();
      return reply({ invitations, locations });
    }
    if (operation === "create") {
      const p = CreateInvitationSchema.safeParse(await jsonBody(request));
      if (!p.success) throw new InvalidInput();
      const token = randomBytes(32).toString("hex");
      const invitation = await repo.create(
        tenant.data,
        p.data,
        createHash("sha256").update(token, "utf8").digest("hex"),
        correlation,
      );
      return reply({ invitation, token }, 201);
    }
    const target = UuidSchema.safeParse(id),
      body = await jsonBody(request);
    if (
      !target.success ||
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length
    )
      throw new InvalidInput();
    return reply(await repo.revoke(tenant.data, target.data, correlation));
  } catch (e) {
    if (e instanceof PermissionDeniedError || e instanceof SameOriginError)
      return reply(
        {
          error:
            "No tienes acceso. Comprueba tu correo verificado, empresa y permisos.",
        },
        403,
      );
    if (e instanceof OnboardingConflictError)
      return reply(
        {
          error:
            "La solicitud cambió, ya tienes acceso a la empresa o la invitación fue usada, revocada o venció.",
        },
        409,
      );
    if (e instanceof InvitationUnavailableError)
      return reply(
        {
          error: "La invitación no está disponible. Solicita un enlace nuevo.",
        },
        404,
      );
    if (
      e instanceof InvalidInput ||
      e instanceof TypeError ||
      e instanceof RangeError
    )
      return reply({ error: "Revisa los datos antes de continuar." }, 400);
    console.error("Onboarding request failed", {
      correlationId: correlation,
      operation,
    });
    return reply(
      {
        error:
          "No pudimos confirmar la operación. Reintenta la misma solicitud.",
      },
      500,
    );
  }
}

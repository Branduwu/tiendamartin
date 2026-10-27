import "server-only";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  OnboardingSchema,
  CreateInvitationSchema,
  AcceptInvitationSchema,
  UuidSchema,
  type InvitationEmailStatus,
} from "@smartretail/contracts";
import { PermissionDeniedError } from "@smartretail/application";
import {
  OnboardingConflictError,
  InvitationUnavailableError,
} from "@smartretail/database";
import { verifiedUserId } from "./auth";
import { sendInvitationEmail } from "./invitation-email";
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
      const { creationNonce, ...intent } = p.data;
      // Stable only for this authorized creation attempt. The existing unique
      // token_hash prevents duplicate commits (and mail) across workers/retries.
      const token = creationNonce
        ? createHash("sha256")
            .update(
              [
                "smartretail.invitation.v1",
                actor.toLowerCase(),
                tenant.data.toLowerCase(),
                creationNonce,
              ].join("\0"),
              "utf8",
            )
            .digest("hex")
        : randomBytes(32).toString("hex");
      const invitation = await repo.create(
        tenant.data,
        intent,
        createHash("sha256").update(token, "utf8").digest("hex"),
        correlation,
      );
      let emailDelivery: { status: InvitationEmailStatus } = {
        status: "unknown",
      };
      try {
        emailDelivery = await sendInvitationEmail(invitation, token);
      } catch {
        // Persistence already committed. Never turn a mail failure into a create retry.
      }
      console.info("Invitation email outcome", {
        correlationId: correlation,
        actorId: actor,
        tenantId: tenant.data,
        invitationId: invitation.id,
        status: emailDelivery.status,
      });
      return reply({ invitation, token, emailDelivery }, 201);
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
    if (
      e instanceof Error &&
      "code" in e &&
      e.code === "23505" &&
      "constraint" in e &&
      e.constraint === "tenant_invitations_token_hash_key"
    )
      return reply(
        {
          error:
            "Esta solicitud de invitación ya se registró. Consulta las invitaciones; no repitas el envío.",
        },
        409,
      );
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

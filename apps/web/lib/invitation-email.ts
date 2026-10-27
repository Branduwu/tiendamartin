import "server-only";
import {
  AcceptInvitationSchema,
  CreateInvitationSchema,
  UuidSchema,
  type InvitationEmailStatus,
} from "@smartretail/contracts";
import type { Invitation } from "@smartretail/database";
import { appOrigin } from "./app-origin";

const roles = {
  admin: "Administrador",
  cashier: "Cajero",
  inventory_clerk: "Almacén",
};

/** One attempt after persistence; an ambiguous response must never recreate an invitation. */
export async function sendInvitationEmail(
  invitation: Invitation,
  token: string,
): Promise<{ status: InvitationEmailStatus }> {
  const valid = CreateInvitationSchema.safeParse({
    email: invitation.email,
    role: invitation.role,
    locationIds: invitation.locationIds,
    expiresInDays: 1,
  });
  if (
    !valid.success ||
    !UuidSchema.safeParse(invitation.id).success ||
    !AcceptInvitationSchema.safeParse({ token }).success ||
    invitation.acceptedAt !== null ||
    invitation.revokedAt !== null ||
    !Number.isFinite(Date.parse(invitation.expiresAt)) ||
    Date.parse(invitation.expiresAt) <= Date.now()
  )
    return { status: "not_sent" };
  let origin: URL | undefined;
  try {
    origin = appOrigin();
  } catch {
    return { status: "not_sent" };
  }
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key || !origin || origin.protocol !== "https:")
    return { status: "not_sent" };
  const link = new URL("/invite", origin);
  link.hash = "token=" + token;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `invitation/${invitation.id}`,
      },
      body: JSON.stringify({
        from: "SmartRetail <noreply@smartretailapp.live>",
        to: [valid.data.email],
        subject: "Te invitaron a SmartRetail",
        text: [
          "Te invitaron a unirte a un negocio en SmartRetail.",
          `Rol asignado: ${roles[valid.data.role]}.`,
          `Abre este enlace privado antes de ${new Date(invitation.expiresAt).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}:`,
          link.href,
          "Inicia sesión o crea tu cuenta con este mismo correo y verifícalo para aceptar.",
          "Si no esperabas esta invitación, puedes ignorar el mensaje.",
        ].join("\n\n"),
      }),
    });
    if (!response.ok)
      return {
        status:
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 409].includes(response.status)
            ? "not_sent"
            : "unknown",
      };
    const data: unknown = await response.json();
    return {
      status:
        data !== null &&
        typeof data === "object" &&
        "id" in data &&
        typeof data.id === "string" &&
        data.id.length > 0 &&
        data.id.length <= 128
          ? "accepted"
          : "unknown",
    };
  } catch {
    // Timeout, network failure, or a lost body does not prove rejection.
    return { status: "unknown" };
  }
}

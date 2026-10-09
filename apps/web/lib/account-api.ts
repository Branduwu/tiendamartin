import "server-only";
import {
  ChangePasswordSchema,
  ResetPasswordSchema,
} from "@smartretail/contracts";
import { serverAuth } from "./supabase/server";
import { recoveryAuth, clearAuthCookies } from "./supabase/recovery";
import {
  InvalidInput,
  SameOriginError,
  jsonBody,
  reply,
  requireSameOrigin,
} from "./api";

export const INVALID_RECOVERY =
  "Este enlace ya no es válido. Solicita uno nuevo.";

export async function handleAccount(
  request: Request,
  operation: "reset" | "change" | "reauthenticate",
) {
  let recovery = false;
  let recoveryAccessToken = "",
    recoveryRevoked = false,
    passwordUpdated = false;
  let client: Awaited<ReturnType<typeof serverAuth>> = null;
  try {
    requireSameOrigin(request);
    const body = await jsonBody(request);
    const parsed =
      operation === "reset"
        ? ResetPasswordSchema.safeParse(body)
        : operation === "change"
          ? ChangePasswordSchema.safeParse(body)
          : null;
    if (parsed && !parsed.success) throw new InvalidInput();
    if (
      operation === "reauthenticate" &&
      (!body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length)
    )
      throw new InvalidInput();
    client = operation === "reset" ? await recoveryAuth() : await serverAuth();
    if (!client)
      return reply({ error: "El servicio de cuenta no está disponible." }, 503);
    if (operation === "reset") {
      const value = ResetPasswordSchema.parse(body);
      const { data, error } = await client.auth.exchangeCodeForSession(
        value.code,
        value.flowId ? { flowId: value.flowId } : undefined,
      );
      if (error || !data.session)
        return reply({ error: INVALID_RECOVERY }, 401);
      recovery = true;
      recoveryAccessToken = data.session.access_token;
      const verified = await client.auth.getClaims(data.session.access_token);
      const claims = verified.data?.claims;
      if (
        verified.error ||
        claims?.sub !== data.user.id ||
        !claims?.session_id ||
        !claims.amr?.some(
          (entry) => typeof entry === "object" && entry.method === "recovery",
        )
      )
        return reply({ error: INVALID_RECOVERY }, 401);
      // Only the verified PKCE recovery purpose is accepted, never a login OTP.
      const result = await client.auth.updateUser({ password: value.password });
      if (
        result.error?.code === "current_password_invalid" ||
        result.error?.code === "current_password_mismatch" ||
        result.error?.code === "current_password_required"
      )
        return reply({ error: INVALID_RECOVERY }, 401);
      if (result.error)
        return reply(
          {
            error:
              "No pudimos guardar la contraseña. Usa una diferente y solicita un nuevo enlace.",
          },
          400,
        );
    } else {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user)
        return reply({ error: "Inicia sesión para continuar." }, 401);
      if (operation === "reauthenticate") {
        const result = await client.auth.reauthenticate();
        return result.error
          ? reply(
              {
                error:
                  "No pudimos enviar el código. Espera unos minutos antes de intentarlo de nuevo.",
              },
              429,
            )
          : reply({
              message:
                "Revisa el correo de tu cuenta para confirmar el cambio.",
            });
      }
      const value = ChangePasswordSchema.parse(body);
      const result = await client.auth.updateUser({
        password: value.password,
        current_password: value.currentPassword,
        ...(value.nonce ? { nonce: value.nonce } : {}),
      });
      if (
        result.error?.code === "current_password_invalid" ||
        result.error?.code === "current_password_mismatch" ||
        result.error?.code === "current_password_required"
      )
        return reply(
          {
            code: "current_password_invalid",
            error: "Revisa la contraseña actual.",
          },
          400,
        );
      if (
        result.error?.code === "reauthentication_needed" ||
        result.error?.code === "reauthentication_not_valid"
      )
        return reply(
          {
            code: "reauthentication_required",
            error: "Solicita un código de confirmación para continuar.",
          },
          409,
        );
      if (result.error)
        return reply(
          {
            error:
              "No pudimos cambiar la contraseña. Revisa la contraseña actual y usa una nueva diferente.",
          },
          400,
        );
    }
    passwordUpdated = true;
    if (operation === "reset") await clearAuthCookies();
    const ended = await client.auth.signOut({ scope: "global" });
    if (ended.error)
      return reply(
        {
          code: "password_saved_logout_failed",
          error:
            "La contraseña se guardó, pero no pudimos cerrar las sesiones. Cierra sesión antes de continuar.",
        },
        503,
      );
    recoveryRevoked = true;
    return reply({
      message: "Contraseña actualizada. Inicia sesión con tu nueva contraseña.",
    });
  } catch (error) {
    if (passwordUpdated)
      return reply(
        {
          code: "password_saved_logout_failed",
          error:
            "La contraseña se guardó, pero no pudimos cerrar las sesiones. Cierra sesión antes de continuar.",
        },
        503,
      );
    if (error instanceof SameOriginError)
      return reply({ error: "Solicitud no permitida." }, 403);
    if (error instanceof InvalidInput)
      return reply(
        {
          error:
            "Revisa las contraseñas: mínimo 8 y máximo 128 caracteres; ambas deben coincidir.",
        },
        400,
      );
    return reply(
      {
        error:
          operation === "reset"
            ? INVALID_RECOVERY
            : "No pudimos completar el cambio. Inténtalo de nuevo.",
      },
      503,
    );
  } finally {
    // Recovery never leaves a reusable application session, including provider failures.
    if (recovery && client) {
      try {
        if (!recoveryRevoked && recoveryAccessToken) {
          const revoked = await client.auth.admin.signOut(
            recoveryAccessToken,
            "local",
          );
          if (revoked.error) console.warn("account_recovery_revocation_failed");
        }
        const ended = await client.auth.signOut({ scope: "local" });
        if (ended.error) console.warn("account_recovery_cleanup_failed");
      } catch {
        console.warn("account_recovery_cleanup_failed");
      }
      recoveryAccessToken = "";
    }
  }
}

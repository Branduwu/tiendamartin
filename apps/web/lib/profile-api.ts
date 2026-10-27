import "server-only";
import { randomUUID } from "node:crypto";
import {
  PersonalProfileSchema,
  UuidSchema,
  type PersonalProfile,
} from "@smartretail/contracts";
import type { User } from "@supabase/supabase-js";
import { serverAuth } from "./supabase/server";
import { platformForUser, tenantsForUser } from "./database";
import {
  InvalidInput,
  SameOriginError,
  jsonBody,
  reply,
  requireSameOrigin,
} from "./api";

export const profilePhotosEnabled = () =>
  process.env.PROFILE_PHOTOS_ENABLED === "true";
function personalData(user: User): PersonalProfile {
  const meta = user.user_metadata ?? {};
  const name = (value: unknown) =>
    typeof value === "string" && !/[\p{Cc}\p{Cf}\p{Cs}<>]/u.test(value)
      ? value.trim().slice(0, 80)
      : "";
  const firstName = name(
    meta.first_name ?? meta.full_name ?? meta.display_name,
  );
  const lastName = name(meta.last_name);
  return {
    firstName,
    lastName,
    phone:
      typeof meta.profile_phone === "string" &&
      /^[+()\d .-]{0,40}$/.test(meta.profile_phone)
        ? meta.profile_phone
        : "",
    displayName: [firstName, lastName].filter(Boolean).join(" "),
    email: user.email ?? "",
    photoEnabled: profilePhotosEnabled(),
  };
}
export async function handleProfile(request: Request) {
  const correlationId = randomUUID();
  let mutationStarted = false;
  try {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "PATCH")
      return reply({ error: "Operación no permitida." }, 405);
    if (
      (request.method !== "GET" && url.searchParams.size) ||
      [...url.searchParams.keys()].some((k) => k !== "summary") ||
      (url.searchParams.size &&
        (url.searchParams.getAll("summary").length !== 1 ||
          url.searchParams.get("summary") !== "1"))
    )
      throw new InvalidInput();
    const client = await serverAuth();
    if (!client)
      return reply({ error: "El servicio de perfil no está disponible." }, 503);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || !UuidSchema.safeParse(data.user.id).success)
      return reply({ error: "Inicia sesión para continuar." }, 401);
    if (request.method === "GET") {
      const profile = personalData(data.user);
      if (url.searchParams.has("summary"))
        return reply({
          displayName: profile.displayName,
          photoEnabled: profile.photoEnabled,
        });
      const [memberships, platformAdmin] = await Promise.all([
        tenantsForUser(data.user.id),
        platformForUser(data.user.id).access(),
      ]);
      return reply({
        ...profile,
        roles: memberships.map((m) => ({
          company: m.tenantName,
          role: m.role,
          status: m.tenantStatus,
        })),
        platformAdmin,
      });
    }
    requireSameOrigin(request);
    const parsed = PersonalProfileSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new InvalidInput();
    const value = parsed.data;
    const fullName = [value.firstName, value.lastName]
      .filter(Boolean)
      .join(" ");
    mutationStarted = true;
    const result = await client.auth.updateUser({
      data: {
        first_name: value.firstName,
        last_name: value.lastName,
        profile_phone: value.phone,
        full_name: fullName,
        display_name: fullName,
      },
    });
    if (result.error) {
      if (!result.error.status || result.error.status >= 500)
        return reply(
          {
            code: "profile_update_unconfirmed",
            error:
              "No pudimos confirmar el guardado. Consulta tu perfil antes de volver a guardar.",
          },
          503,
        );
      return reply(
        {
          error:
            "No pudimos guardar tu perfil. Revisa los datos e inténtalo de nuevo.",
        },
        400,
      );
    }
    if (!result.data.user || result.data.user.id !== data.user.id)
      return reply(
        {
          code: "profile_update_unconfirmed",
          error:
            "No pudimos confirmar el guardado. Consulta tu perfil antes de volver a guardar.",
        },
        503,
      );
    console.info("Profile operation", {
      operation: "profile.update",
      actorId: data.user.id,
      correlationId,
      at: new Date().toISOString(),
    });
    return reply(personalData(result.data.user));
  } catch (error) {
    if (error instanceof SameOriginError)
      return reply({ error: "Solicitud no permitida." }, 403);
    if (error instanceof InvalidInput)
      return reply(
        {
          error:
            "Revisa nombre, apellidos y teléfono. No se pueden cambiar correo ni permisos desde el perfil.",
        },
        400,
      );
    return reply(
      {
        ...(mutationStarted ? { code: "profile_update_unconfirmed" } : {}),
        error: mutationStarted
          ? "No pudimos confirmar el guardado. Consulta tu perfil antes de volver a guardar."
          : "No pudimos consultar tu perfil. Intenta de nuevo.",
      },
      503,
    );
  }
}

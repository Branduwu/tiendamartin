import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { UuidSchema } from "@smartretail/contracts";
import { serverAuth } from "./supabase/server";
import { profilePhotosEnabled } from "./profile-api";
import { normalizedProductImage } from "./product-image-processing";
import { reply, requireSameOrigin, SameOriginError } from "./api";
import {
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_MIME,
  PROFILE_PHOTO_ERROR,
} from "./profile-photo-policy";

export async function normalizedProfilePhoto(bytes: Uint8Array, mime: string) {
  if (
    mime !== PROFILE_PHOTO_MIME ||
    !bytes.length ||
    bytes.length > PROFILE_PHOTO_MAX_BYTES
  )
    throw new TypeError("Invalid profile photo");
  const safe = await normalizedProductImage(bytes, mime);
  return sharp(safe)
    .resize(256, 256, { fit: "cover" })
    .jpeg({ quality: 82 })
    .toBuffer();
}
async function boundedBody(
  request: Request,
  maxBytes = PROFILE_PHOTO_MAX_BYTES,
) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new TypeError("Image too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export async function handleProfilePhoto(request: Request) {
  const correlationId = randomUUID();
  let mutationStarted = false;
  try {
    if (!["GET", "PUT", "DELETE"].includes(request.method))
      return reply({ error: "Operación no permitida." }, 405);
    const query = new URL(request.url).searchParams;
    if (
      [...query.keys()].some((k) => k !== "v") ||
      (query.size &&
        (request.method !== "GET" ||
          query.getAll("v").length !== 1 ||
          !/^\d{1,16}$/.test(query.get("v") ?? "")))
    )
      throw new TypeError("Invalid query");
    const client = await serverAuth();
    if (!client)
      return reply({ error: "El servicio de perfil no está disponible." }, 503);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || !UuidSchema.safeParse(data.user.id).success)
      return reply({ error: "Inicia sesión para continuar." }, 401);
    if (request.method !== "GET") requireSameOrigin(request);
    if (!profilePhotosEnabled())
      return reply(
        {
          code: "profile_photo_unavailable",
          error: "La fotografía de perfil todavía no está habilitada.",
        },
        503,
      );
    const path = data.user.id.toLowerCase() + "/avatar.jpg";
    // The authenticated user's own Storage client enforces RLS. No service key.
    const storage = client.storage.from("profile-photos");
    if (request.method === "GET") {
      // A fixed avatar path can retain old CDN bytes after a successful upsert.
      // Downstream no-store does not bypass that upstream cache.
      const result = await storage.download(path, { cacheNonce: randomUUID() });
      if (result.error) {
        if (
          ["404", "NoSuchKey", "ObjectNotFound", "not_found"].includes(
            String(result.error.statusCode),
          )
        )
          return reply({ error: "Todavía no tienes fotografía." }, 404);
        throw new Error("Storage unavailable");
      }
      if (!result.data) throw new Error("Storage unavailable");
      return new Response(result.data, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'",
          "Content-Disposition": 'inline; filename="perfil.jpg"',
        },
      });
    }
    if (request.method === "PUT") {
      const image = await normalizedProfilePhoto(
        await boundedBody(request),
        request.headers.get("content-type")?.split(";")[0]?.trim() ?? "",
      );
      mutationStarted = true;
      const result = await storage.upload(path, image, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "0",
      });
      if (result.error) throw new Error("Storage write unconfirmed");
    } else {
      // Next may wrap a bodyless DELETE in an empty stream. Reject bytes,
      // rather than rejecting the stream itself, and keep the read bounded.
      await boundedBody(request, 0);
      mutationStarted = true;
      const result = await storage.remove([path]);
      if (result.error) throw new Error("Storage delete unconfirmed");
    }
    console.info("Profile operation", {
      operation:
        request.method === "PUT"
          ? "profile.photo.replace"
          : "profile.photo.remove",
      actorId: data.user.id,
      correlationId,
      at: new Date().toISOString(),
    });
    return reply({ saved: true });
  } catch (error) {
    if (error instanceof SameOriginError)
      return reply({ error: "Solicitud no permitida." }, 403);
    if (error instanceof TypeError)
      return reply({ error: PROFILE_PHOTO_ERROR }, 400);
    return reply(
      {
        ...(mutationStarted ? { code: "profile_photo_unconfirmed" } : {}),
        error: mutationStarted
          ? "No pudimos confirmar el cambio de foto. Consulta tu perfil antes de repetirlo."
          : "No pudimos consultar la fotografía. Intenta de nuevo.",
      },
      503,
    );
  }
}

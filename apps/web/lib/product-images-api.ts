import "server-only";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { UuidSchema } from "@smartretail/contracts";
import {
  PermissionDeniedError,
  ProductNotFoundError,
} from "@smartretail/application";
import {
  ProductImageConflictError,
  ProductImageRateLimitError,
} from "@smartretail/database";
import { verifiedUserId } from "./auth";
import { productImagesForUser } from "./database";
import { reply, requireSameOrigin, SameOriginError } from "./api";
import { normalizedProductImage } from "./product-image-processing";
export async function handleProductImageList(request: Request) {
  try {
    const user = await verifiedUserId();
    if (!user) return reply({ error: "Inicia sesión para continuar." }, 401);
    if (new URL(request.url).searchParams.size)
      throw new TypeError("Invalid query");
    const tenant = UuidSchema.parse(request.headers.get("x-tenant-id"));
    return reply({
      images: await productImagesForUser(user, tenant).listImages(),
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError)
      return reply({ error: "No tienes acceso a estas fotos." }, 403);
    if (
      error instanceof TypeError ||
      (error instanceof Error && error.name === "ZodError")
    )
      return reply({ error: "Revisa la empresa seleccionada." }, 400);
    return reply({ error: "No pudimos cargar las fotos." }, 503);
  }
}
function storage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_STORAGE_SECRET_KEY;
  if (!url || !key) throw new Error("Image storage unavailable");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  }).storage.from("product-images");
}
async function imageBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new TypeError("Missing image");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 3 * 1024 * 1024) {
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
export async function handleProductImage(request: Request, id: string) {
  const correlationId = randomUUID();
  try {
    const user = await verifiedUserId();
    if (!user) return reply({ error: "Inicia sesión para continuar." }, 401);
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some(
        (k) =>
          !["tenantId", "metadata"].includes(k) ||
          params.getAll(k).length !== 1,
      ) ||
      (params.has("metadata") && params.get("metadata") !== "1")
    )
      throw new TypeError("Invalid query");
    const tenant = UuidSchema.parse(
        request.method === "GET"
          ? params.get("tenantId")
          : request.headers.get("x-tenant-id"),
      ),
      product = UuidSchema.parse(id);
    const repo = productImagesForUser(user, tenant);
    if (request.method === "GET") {
      const image = await repo.image(product);
      if (params.has("metadata"))
        return reply({ imageId: image?.imageId ?? null });
      if (!image) return reply({ error: "Este producto no tiene foto." }, 404);
      const { data, error } = await storage().download(image.objectPath);
      if (error || !data) throw new Error("Storage read failed");
      return new Response(data, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'",
          "Content-Disposition": 'inline; filename="producto.jpg"',
        },
      });
    }
    requireSameOrigin(request);
    if (params.size) throw new TypeError("Invalid query");
    const expectedHeader = request.headers.get("x-product-image-version");
    const expected =
      expectedHeader === "none" ? null : UuidSchema.parse(expectedHeader);
    if (!["PUT", "DELETE"].includes(request.method))
      return reply({ error: "Operación no permitida." }, 405);
    // Check membership/product before spending resources on decode. Write is checked again under lock.
    await repo.assertWrite(product, correlationId);
    const bytes =
      request.method === "PUT"
        ? await normalizedProductImage(
            await imageBody(request),
            request.headers.get("content-type") ?? "",
          )
        : null;
    const imageId = bytes ? randomUUID() : null;
    if (bytes && imageId) {
      const path =
        tenant.toLowerCase() +
        "/" +
        product.toLowerCase() +
        "/" +
        imageId +
        ".jpg";
      const { error } = await storage().upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (error) throw new Error("Storage write failed");
    }
    const old = await repo.changeImage(
      product,
      expected,
      imageId,
      correlationId,
    );
    // Objects are immutable. Failed deletion leaves an inaccessible orphan, never a broken current reference.
    if (old) {
      try {
        await storage().remove([old]);
      } catch {
        /* Administrative cleanup can retry later. */
      }
    }
    console.info(
      JSON.stringify({
        operation: bytes ? "products.photo.replace" : "products.photo.remove",
        actor: user,
        tenantId: tenant,
        productId: product,
        correlationId,
        at: new Date().toISOString(),
      }),
    );
    return reply({ imageId });
  } catch (error) {
    if (error instanceof ProductImageRateLimitError)
      return reply(
        { error: "Has cambiado muchas fotos. Intenta más tarde." },
        429,
      );
    if (
      error instanceof PermissionDeniedError ||
      error instanceof SameOriginError
    )
      return reply({ error: "No tienes permiso para usar esta foto." }, 403);
    if (error instanceof ProductNotFoundError)
      return reply({ error: "Producto no disponible." }, 404);
    if (error instanceof ProductImageConflictError)
      return reply(
        { error: "La foto cambió. Recarga el producto antes de reemplazarla." },
        409,
      );
    if (
      error instanceof TypeError ||
      (error instanceof Error && error.name === "ZodError")
    )
      return reply(
        { error: "Elige una imagen JPEG, PNG o WebP válida de hasta 3 MB." },
        400,
      );
    return reply(
      { error: "No pudimos guardar o leer la foto. Intenta de nuevo." },
      503,
    );
  }
}

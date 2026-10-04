import "server-only";
import { randomUUID } from "node:crypto";
import {
  CreateProductSchema,
  UpdateProductSchema,
  UuidSchema,
} from "@smartretail/contracts";
import {
  listProducts,
  createProduct,
  updateProduct,
  PermissionDeniedError,
  ProductNotFoundError,
} from "@smartretail/application";
import {
  DatabaseUniquenessConflictError,
  ProductStorageConflictError,
} from "@smartretail/database";
import { verifiedUserId } from "./auth";
import { productsForUser, tenantsForUser } from "./database";
import { productInput, productChanges, productDto } from "./product-mapping";
import { TaxProfileUnavailableError } from "@smartretail/domain";

export class InvalidInput extends Error {}
export class SameOriginError extends Error {}
export const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

// Require browser Origin for cookie mutations; reject cross-site Fetch Metadata.
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Next may normalize request.url to its internal listener hostname. Browsers
  // derive Host from the destination; web JS cannot override it. No forwarded-host.
  const host = request.headers.get("host") ?? url.host;
  if (
    !/^https?:$/.test(url.protocol) ||
    !/^(?:\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(?::[0-9]{1,5})?$/.test(host)
  )
    throw new SameOriginError();
  let expected: URL;
  try {
    expected = new URL(`${url.protocol}//${host}`);
  } catch {
    throw new SameOriginError();
  }
  if (
    expected.username ||
    expected.password ||
    expected.pathname !== "/" ||
    expected.search ||
    expected.hash
  )
    throw new SameOriginError();
  if (
    !origin ||
    origin !== expected.origin ||
    ["cross-site", "same-site"].includes(
      request.headers.get("sec-fetch-site") ?? "",
    )
  )
    throw new SameOriginError();
}

export async function jsonBody(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    throw new InvalidInput();
  // Bound streamed bytes too: Content-Length is supplied by the caller.
  const reader = request.body?.getReader();
  if (!reader) throw new InvalidInput();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new InvalidInput();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new InvalidInput();
  } finally {
    reader.releaseLock();
  }
}

export async function handleApi(
  request: Request,
  operation: "tenants" | "list" | "create" | "update",
  id?: string,
) {
  const correlationId = randomUUID();
  let userId: string | null = null;
  let tenantId: string | undefined;
  try {
    userId = await verifiedUserId();
    if (!userId) return reply({ error: "Inicia sesión para continuar." }, 401);
    if (operation === "tenants")
      return reply({ tenants: await tenantsForUser(userId) });
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success) throw new InvalidInput();
    tenantId = tenant.data;
    const repository = productsForUser(userId, tenantId);
    if (operation === "list")
      return reply({
        products: (await listProducts(repository)).map(productDto),
      });
    requireSameOrigin(request);
    const body = await jsonBody(request);
    let result;
    if (operation === "create") {
      const parsed = CreateProductSchema.safeParse(body);
      if (!parsed.success) throw new InvalidInput();
      result = await createProduct(
        repository,
        productInput(randomUUID(), parsed.data),
      );
    } else {
      const parsed = UpdateProductSchema.safeParse(body);
      const productId = UuidSchema.safeParse(id);
      if (!parsed.success || !productId.success) throw new InvalidInput();
      result = await updateProduct(
        repository,
        productId.data,
        productChanges(parsed.data),
      );
    }
    // Metadata only: no payload, credentials, SQL or personal contact data.
    console.info(
      JSON.stringify({
        operation: `products.${operation}`,
        userId,
        tenantId,
        correlationId,
        at: new Date().toISOString(),
      }),
    );
    return reply(
      { product: productDto(result) },
      operation === "create" ? 201 : 200,
    );
  } catch (error) {
    if (error instanceof TaxProfileUnavailableError)
      return reply(
        {
          error:
            "El impuesto no existe, está inactivo o no pertenece a esta empresa. Actualiza la selección del producto.",
        },
        409,
      );
    if (
      error instanceof PermissionDeniedError ||
      error instanceof SameOriginError
    )
      return reply({ error: "No tienes permiso para esta operación." }, 403);
    if (error instanceof InvalidInput || error instanceof RangeError)
      return reply(
        { error: "Revisa los campos y los importes del producto." },
        400,
      );
    if (error instanceof ProductNotFoundError)
      return reply({ error: "Producto no encontrado." }, 404);
    if (error instanceof DatabaseUniquenessConflictError)
      return reply({ error: "El SKU o código de barras ya está en uso." }, 409);
    if (error instanceof ProductStorageConflictError)
      return reply(
        {
          error:
            "La unidad no puede cambiar porque el producto tiene registros de inventario.",
        },
        409,
      );
    console.error(
      JSON.stringify({
        operation,
        correlationId,
        at: new Date().toISOString(),
        outcome: "unexpected_error",
      }),
    );
    return reply(
      { error: "No se pudo completar la operación.", correlationId },
      500,
    );
  }
}

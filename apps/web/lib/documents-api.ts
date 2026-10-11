import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { UuidSchema } from "@smartretail/contracts";
import {
  PermissionDeniedError,
  PurchasingNotFoundError,
} from "@smartretail/application";
import { verifiedUserId } from "./auth";
import { purchasingForUser } from "./database";
import { reply, requireSameOrigin, SameOriginError } from "./api";
import { DOCUMENT_LIMITS } from "./document-proposal";
import { validateDocumentBytes } from "./document-validation";
import { DocumentFormatError } from "./document-preflight";

async function documentBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new TypeError("Missing document");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > DOCUMENT_LIMITS.bytes) {
        await reader.cancel();
        throw new TypeError("Document too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
function storage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_STORAGE_SECRET_KEY;
  if (!url || !key) throw new Error("Document storage unavailable");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  }).storage.from("purchase-documents");
}
export async function handleDocument(request: Request, purchaseId?: string) {
  const correlationId = randomUUID();
  try {
    const user = await verifiedUserId();
    if (!user) return reply({ error: "Inicia sesión para continuar." }, 401);
    if (new URL(request.url).searchParams.size)
      throw new TypeError("Invalid query");
    const tenant = UuidSchema.parse(
      request.headers.get("x-tenant-id"),
    ).toLowerCase();
    const repo = purchasingForUser(user, tenant, correlationId);
    const id =
      purchaseId === undefined
        ? undefined
        : UuidSchema.parse(purchaseId).toLowerCase();
    if (request.method === "GET" && id) {
      await repo.assertDocumentPurchase(id);
      const { data, error } = await storage().download(
        `${tenant}/${id}/original`,
      );
      if (error || !data)
        return reply(
          { error: "Esta compra no tiene documento disponible." },
          404,
        );
      console.info(
        JSON.stringify({
          operation: "purchases.document.download",
          actor: user,
          tenantId: tenant,
          purchaseId: id,
          correlationId,
          at: new Date().toISOString(),
        }),
      );
      return new Response(data, {
        headers: {
          "Content-Type": data.type || "application/octet-stream",
          "Content-Disposition": 'attachment; filename="documento-compra"',
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'",
        },
      });
    }
    requireSameOrigin(request);
    if ((!id && request.method !== "POST") || (id && request.method !== "PUT"))
      return reply({ error: "Operación no permitida." }, 405);
    await repo.assertDocumentCapture();
    if (id) await repo.assertDocumentPurchase(id, true);
    const bytes = await documentBody(request),
      mime = request.headers.get("content-type") ?? "";
    const metadata = await validateDocumentBytes(bytes, mime);
    if (!id) return reply(metadata);
    const path = `${tenant}/${id}/original`,
      bucket = storage();
    const { error } = await bucket.upload(path, bytes, {
      contentType: mime,
      upsert: false,
    });
    if (error) {
      const existing = await bucket.download(path);
      if (existing.error || !existing.data)
        throw new Error("Storage write failed");
      const hash = (b: Uint8Array) =>
        createHash("sha256").update(b).digest("hex");
      if (
        existing.data.type !== mime ||
        hash(new Uint8Array(await existing.data.arrayBuffer())) !== hash(bytes)
      )
        return reply(
          { error: "La compra ya tiene un documento diferente." },
          409,
        );
    }
    console.info(
      JSON.stringify({
        operation: "purchases.document.attach",
        actor: user,
        tenantId: tenant,
        purchaseId: id,
        correlationId,
        at: new Date().toISOString(),
      }),
    );
    return reply({ attached: true });
  } catch (error) {
    if (error instanceof DocumentFormatError)
      return reply({ error: error.message }, 400);
    if (
      error instanceof PermissionDeniedError ||
      error instanceof SameOriginError
    )
      return reply(
        { error: "No tienes permiso para usar este documento." },
        403,
      );
    if (error instanceof PurchasingNotFoundError)
      return reply({ error: "Compra no disponible." }, 404);
    if (
      error instanceof TypeError ||
      (error instanceof Error && error.name === "ZodError")
    )
      return reply(
        {
          error:
            "Usa una imagen válida de hasta 12 megapíxeles o un PDF de hasta 5 páginas, máximo 4 MB.",
        },
        400,
      );
    return reply(
      {
        error:
          "No pudimos procesar el documento. Puedes continuar con una compra manual.",
      },
      503,
    );
  }
}

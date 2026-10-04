import "server-only";
import { randomUUID } from "node:crypto";
import {
  UuidSchema,
  CouponInputSchema,
  CouponUpdateSchema,
  PromotionInputSchema,
  PromotionUpdateSchema,
} from "@smartretail/contracts";
import { PermissionDeniedError } from "@smartretail/application";
import {
  DatabaseUniquenessConflictError,
  PromotionNotFoundError,
} from "@smartretail/database";
import { verifiedUserId } from "./auth";
import { promotionsForUser } from "./database";
import {
  InvalidInput,
  SameOriginError,
  requireSameOrigin,
  jsonBody,
  reply,
} from "./api";
export async function handlePromotions(
  request: Request,
  kind: "coupons" | "promotions",
  operation: "list" | "create" | "update",
  id?: string,
) {
  const correlationId = randomUUID();
  try {
    const userId = await verifiedUserId();
    if (!userId) return reply({ error: "Inicia sesión para continuar." }, 401);
    const tenant = UuidSchema.safeParse(request.headers.get("x-tenant-id"));
    if (!tenant.success || new URL(request.url).search)
      throw new InvalidInput();
    const repo = promotionsForUser(userId, tenant.data);
    if (operation === "list")
      return reply(
        kind === "coupons"
          ? { coupons: await repo.listCoupons() }
          : { promotions: await repo.listPromotions() },
      );
    requireSameOrigin(request);
    await repo.authorize("promotions.write");
    const body = await jsonBody(request),
      update = operation === "update";
    if (update && !UuidSchema.safeParse(id).success) throw new InvalidInput();
    if (kind === "coupons") {
      const parsed = update
        ? CouponUpdateSchema.safeParse(body)
        : CouponInputSchema.safeParse(body);
      if (!parsed.success) throw new InvalidInput();
      const result = await repo.saveCoupon(
        {
          ...parsed.data,
          id: update ? id! : "id" in parsed.data ? String(parsed.data.id) : "",
        },
        update,
        correlationId,
      );
      return reply({ coupon: result }, update ? 200 : 201);
    }
    const parsed = update
      ? PromotionUpdateSchema.safeParse(body)
      : PromotionInputSchema.safeParse(body);
    if (!parsed.success) throw new InvalidInput();
    const result = await repo.savePromotion(
      {
        ...parsed.data,
        id: update ? id! : "id" in parsed.data ? String(parsed.data.id) : "",
      },
      update,
      correlationId,
    );
    return reply({ promotion: result }, update ? 200 : 201);
  } catch (e) {
    if (e instanceof PermissionDeniedError || e instanceof SameOriginError)
      return reply(
        { error: "No tienes permiso para administrar promociones." },
        403,
      );
    if (
      e instanceof InvalidInput ||
      e instanceof TypeError ||
      e instanceof RangeError
    )
      return reply(
        { error: "Revisa el código, descuento, fechas y límite de usos." },
        400,
      );
    if (e instanceof PromotionNotFoundError)
      return reply({ error: "Promoción o producto no encontrado." }, 404);
    if (e instanceof DatabaseUniquenessConflictError)
      return reply(
        { error: "El código o identificador ya existe en esta empresa." },
        409,
      );
    console.error(
      JSON.stringify({
        operation: kind + "." + operation,
        correlationId,
        outcome: "unexpected_error",
      }),
    );
    return reply(
      { error: "No pudimos completar la operación.", correlationId },
      500,
    );
  }
}

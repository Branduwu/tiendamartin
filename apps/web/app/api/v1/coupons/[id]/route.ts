import { handlePromotions } from "../../../../../lib/promotions-api";
export const dynamic = "force-dynamic";
export const PATCH = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => handlePromotions(r, "coupons", "update", (await c.params).id);

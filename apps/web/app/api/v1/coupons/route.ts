import { handlePromotions } from "../../../../lib/promotions-api";
export const dynamic = "force-dynamic";
export const GET = (r: Request) => handlePromotions(r, "coupons", "list");
export const POST = (r: Request) => handlePromotions(r, "coupons", "create");

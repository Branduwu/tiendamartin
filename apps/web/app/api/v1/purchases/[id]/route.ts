import { handlePurchasing } from "../../../../../lib/purchasing-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => handlePurchasing(request, "purchase", (await context.params).id);
export const PATCH = async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => handlePurchasing(request, "update-purchase", (await context.params).id);

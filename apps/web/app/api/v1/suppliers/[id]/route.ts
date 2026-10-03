import { handlePurchasing } from "../../../../../lib/purchasing-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PATCH = async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => handlePurchasing(request, "update-supplier", (await context.params).id);

import { handlePurchasing } from "../../../../../../lib/purchasing-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => handlePurchasing(request, "cancel", (await context.params).id);

import { handlePurchasing } from "../../../../lib/purchasing-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handlePurchasing(request, "suppliers");
export const POST = (request: Request) =>
  handlePurchasing(request, "create-supplier");

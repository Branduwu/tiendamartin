import { handleSuspendedSales } from "../../../../../lib/suspended-sales-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return handleSuspendedSales(request, "barcode");
}

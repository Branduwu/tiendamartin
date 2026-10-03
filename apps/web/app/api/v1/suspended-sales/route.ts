import { handleSuspendedSales } from "../../../../lib/suspended-sales-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return handleSuspendedSales(request, "suspend");
}
export function GET(request: Request) {
  return handleSuspendedSales(request, "list");
}

import { handleSales } from "../../../../lib/sales-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return handleSales(request, "create");
}

export const GET = (request: Request) => handleSales(request, "list");

import { handleSales } from "../../../../../lib/sales-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleSales(request, "read", (await params).id);
}

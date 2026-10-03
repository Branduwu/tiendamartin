import { handleSuspendedSales } from "../../../../../../lib/suspended-sales-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleSuspendedSales(request, "cancel", (await params).id);
}

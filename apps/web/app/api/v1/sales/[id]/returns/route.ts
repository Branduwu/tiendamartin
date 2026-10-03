import { handleReturns } from "../../../../../../lib/returns-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleReturns(request, (await params).id, "create");
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleReturns(request, (await params).id, "list");
}

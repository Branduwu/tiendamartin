import { handleSupport } from "../../../../../lib/support-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleSupport(r, "detail", (await params).id);
}

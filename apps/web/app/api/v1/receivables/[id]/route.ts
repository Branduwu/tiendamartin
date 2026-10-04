import { handleReceivables } from "../../../../../lib/receivables-api";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleReceivables(request, "read", (await context.params).id);
}

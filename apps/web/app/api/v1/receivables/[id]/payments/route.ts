import { handleReceivables } from "../../../../../../lib/receivables-api";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleReceivables(request, "pay", (await context.params).id);
}

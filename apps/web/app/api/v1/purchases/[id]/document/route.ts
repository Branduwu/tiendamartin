import { handleDocument } from "../../../../../../lib/documents-api";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleDocument(request, (await context.params).id);
}
export const PUT = GET;

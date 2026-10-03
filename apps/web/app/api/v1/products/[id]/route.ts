import { handleApi } from "../../../../../lib/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleApi(request, "update", (await context.params).id);
}

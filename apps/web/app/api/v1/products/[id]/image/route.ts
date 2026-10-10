import { handleProductImage } from "../../../../../../lib/product-images-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleProductImage(request, (await context.params).id);
}
export const PUT = GET;
export const DELETE = GET;

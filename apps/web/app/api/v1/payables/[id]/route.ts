import { handlePayables } from "../../../../../lib/payables-api";
export async function GET(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handlePayables(r, "detail", (await params).id);
}

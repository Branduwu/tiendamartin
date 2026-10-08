import { handlePayables } from "../../../../../../lib/payables-api";
export async function POST(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handlePayables(r, "pay", (await params).id);
}

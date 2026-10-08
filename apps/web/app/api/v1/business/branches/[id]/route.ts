import { handleBusiness } from "../../../../../../lib/business-api";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleBusiness(request, "branch", (await params).id);
}

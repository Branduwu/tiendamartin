import { handleTaxes } from "../../../../../lib/taxes-api";
export const dynamic = "force-dynamic";
export const PATCH = async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => handleTaxes(request, "update", (await context.params).id);

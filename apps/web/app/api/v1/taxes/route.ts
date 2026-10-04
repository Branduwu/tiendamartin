import { handleTaxes } from "../../../../lib/taxes-api";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleTaxes(request, "list");
export const POST = (request: Request) => handleTaxes(request, "create");

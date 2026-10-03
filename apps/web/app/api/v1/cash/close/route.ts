import { handleCash } from "../../../../../lib/cash-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleCash(request, "close");

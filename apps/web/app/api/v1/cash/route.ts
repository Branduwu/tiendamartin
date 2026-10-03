import { handleCash } from "../../../../lib/cash-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleCash(request, "current");

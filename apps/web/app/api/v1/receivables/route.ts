import { handleReceivables } from "../../../../lib/receivables-api";
export const runtime = "nodejs";
export const GET = (request: Request) => handleReceivables(request, "list");

import { handleReports } from "../../../../../lib/reporting-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleReports(request, "products");

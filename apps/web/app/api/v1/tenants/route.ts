import { handleApi } from "../../../../lib/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleApi(request, "tenants");

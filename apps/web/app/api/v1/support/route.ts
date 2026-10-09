import { handleSupport } from "../../../../lib/support-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (r: Request) => handleSupport(r, "list");
export const POST = (r: Request) => handleSupport(r, "create");

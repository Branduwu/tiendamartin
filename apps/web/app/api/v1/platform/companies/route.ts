import { handlePlatform } from "../../../../../lib/platform-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handlePlatform(request, "list");
export const POST = (request: Request) => handlePlatform(request, "create");

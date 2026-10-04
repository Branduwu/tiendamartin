import { handleMembers } from "../../../../lib/members-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleMembers(request, "list");

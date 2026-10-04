import { handleMembers } from "../../../../../lib/members-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const PATCH = async (request: Request, { params }: Context) =>
  handleMembers(request, "update", (await params).id);

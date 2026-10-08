import { handlePlatform } from "../../../../../../lib/platform-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, c: Context) =>
  handlePlatform(request, "detail", (await c.params).id);
export const PATCH = async (request: Request, c: Context) =>
  handlePlatform(request, "status", (await c.params).id);

import { handleCustomers } from "../../../../../lib/customers-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, { params }: Context) =>
  handleCustomers(request, "read", (await params).id);
export const PATCH = async (request: Request, { params }: Context) =>
  handleCustomers(request, "update", (await params).id);

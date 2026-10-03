import { handleCustomers } from "../../../../lib/customers-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleCustomers(request, "list");
export const POST = (request: Request) => handleCustomers(request, "create");

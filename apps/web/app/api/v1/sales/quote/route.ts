import { handleSales } from "../../../../../lib/sales-api";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleSales(request, "quote");

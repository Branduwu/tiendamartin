import { handleInventory } from "../../../../../lib/inventory-api";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleInventory(request, "count");

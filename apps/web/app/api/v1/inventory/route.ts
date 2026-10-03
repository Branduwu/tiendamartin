import { handleInventory } from "../../../../lib/inventory-api";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleInventory(request, "stock");

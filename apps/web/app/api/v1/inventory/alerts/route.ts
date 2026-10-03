import { handleInventoryMinimum } from "../../../../../lib/inventory-minimum-api";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  handleInventoryMinimum(request, "alerts");

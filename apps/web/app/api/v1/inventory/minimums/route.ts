import { handleInventoryMinimum } from "../../../../../lib/inventory-minimum-api";
export const dynamic = "force-dynamic";
export const PATCH = (request: Request) =>
  handleInventoryMinimum(request, "minimums");

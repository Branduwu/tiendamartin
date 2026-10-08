import { handleBusiness } from "../../../../lib/business-api";
export const GET = (request: Request) => handleBusiness(request, "read");
export const PUT = (request: Request) => handleBusiness(request, "save");

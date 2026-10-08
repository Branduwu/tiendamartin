import { handlePayables } from "../../../../lib/payables-api";
export const GET = (r: Request) => handlePayables(r, "list");

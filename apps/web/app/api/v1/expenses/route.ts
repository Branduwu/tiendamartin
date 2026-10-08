import { handlePayables } from "../../../../lib/payables-api";
export const GET = (r: Request) => handlePayables(r, "expenses");
export const POST = (r: Request) => handlePayables(r, "create-expense");

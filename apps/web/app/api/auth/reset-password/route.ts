import { handleAccount } from "../../../../lib/account-api";
export const POST = (request: Request) => handleAccount(request, "reset");

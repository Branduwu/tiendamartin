import { handleOnboarding } from "../../../../lib/onboarding-api";
export const GET = (r: Request) => handleOnboarding(r, "list");
export const POST = (r: Request) => handleOnboarding(r, "create");

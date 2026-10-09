import { handleOnboarding } from "../../../../../lib/onboarding-api";
export const POST = (r: Request) => handleOnboarding(r, "accept");

import { handleOnboarding } from "../../../../lib/onboarding-api";
export const GET = (r: Request) => handleOnboarding(r, "status");
export const POST = (r: Request) => handleOnboarding(r, "onboard");

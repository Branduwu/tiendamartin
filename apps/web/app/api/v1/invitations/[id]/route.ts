import { handleOnboarding } from "../../../../../lib/onboarding-api";
export async function PATCH(
  r: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleOnboarding(r, "revoke", (await context.params).id);
}

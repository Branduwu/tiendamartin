import { expect, it } from "vitest";
import { PersonalProfileSchema } from "../src/index";
const value = {
  firstName: " Ana María ",
  lastName: "O'Connor Pérez",
  phone: "+52 (55) 1234-5678",
};
it("accepts bounded personal data and normalizes whitespace", () => {
  expect(PersonalProfileSchema.parse(value)).toEqual({
    ...value,
    firstName: "Ana María",
  });
  expect(
    PersonalProfileSchema.safeParse({ ...value, lastName: "", phone: "" })
      .success,
  ).toBe(true);
});
for (const field of [
  "userId",
  "email",
  "role",
  "tenantId",
  "permissions",
  "app_metadata",
  "user_metadata",
  "password",
  "avatar_url",
])
  it(`rejects privilege or identity field ${field}`, () => {
    expect(
      PersonalProfileSchema.safeParse({ ...value, [field]: "forged" }).success,
    ).toBe(false);
  });
it("rejects empty, long, hidden or executable names and invalid phone", () => {
  for (const firstName of [
    "",
    " ",
    "x".repeat(81),
    "A\u0000B",
    "A\u200bB",
    "<script>",
  ])
    expect(
      PersonalProfileSchema.safeParse({ ...value, firstName }).success,
    ).toBe(false);
  for (const phone of ["x".repeat(41), "hello@example.test", "123\n45"])
    expect(PersonalProfileSchema.safeParse({ ...value, phone }).success).toBe(
      false,
    );
});

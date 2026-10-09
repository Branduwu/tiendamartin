import { expect, it } from "vitest";
import {
  OnboardingSchema,
  CreateInvitationSchema,
  AcceptInvitationSchema,
} from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440020";
const onboarding = {
  commandId: id,
  businessName: "Empresa",
  tradeName: null,
  phone: null,
  email: null,
  branchName: "Centro",
};
it("validates minimal onboarding and rejects extra privilege fields", () => {
  expect(OnboardingSchema.parse(onboarding)).toEqual(onboarding);
  for (const field of [
    { tenantId: id },
    { ownerUserId: id },
    { role: "owner" },
  ])
    expect(
      OnboardingSchema.safeParse({ ...onboarding, ...field }).success,
    ).toBe(false);
});
it("bounds fields and rejects invisible or missing business identity", () => {
  for (const businessName of ["", " ", " Empresa", "x".repeat(121), "a\u200bb"])
    expect(
      OnboardingSchema.safeParse({ ...onboarding, businessName }).success,
    ).toBe(false);
  expect(
    OnboardingSchema.safeParse({ ...onboarding, email: "invalid" }).success,
  ).toBe(false);
});
it("normalizes invitation email and denies owner or ambiguous assignments", () => {
  const invite = {
    email: "USER@example.test",
    role: "cashier",
    locationIds: [id],
    expiresInDays: 7,
  };
  expect(CreateInvitationSchema.parse(invite).email).toBe("user@example.test");
  for (const changes of [
    { role: "owner" },
    { role: "admin" },
    { locationIds: [id, id] },
    { locations: [id] },
    { expiresInDays: "7" },
  ])
    expect(
      CreateInvitationSchema.safeParse({ ...invite, ...changes }).success,
    ).toBe(false);
});
it("bounds expiration and location collection", () => {
  for (const expiresInDays of [0, 15, 1.5])
    expect(
      CreateInvitationSchema.safeParse({
        email: "user@example.test",
        role: "admin",
        locationIds: [],
        expiresInDays,
      }).success,
    ).toBe(false);
  expect(
    CreateInvitationSchema.safeParse({
      email: "user@example.test",
      role: "cashier",
      locationIds: Array(101).fill(id),
      expiresInDays: 7,
    }).success,
  ).toBe(false);
});
it("accepts only an exact bounded token without identity fields", () => {
  expect(
    AcceptInvitationSchema.safeParse({ token: "a".repeat(64) }).success,
  ).toBe(true);
  for (const token of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), 100])
    expect(AcceptInvitationSchema.safeParse({ token }).success).toBe(false);
  expect(
    AcceptInvitationSchema.safeParse({
      token: "a".repeat(64),
      email: "other@example.test",
    }).success,
  ).toBe(false);
});

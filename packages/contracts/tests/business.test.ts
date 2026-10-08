import { expect, it } from "vitest";
import { BusinessProfileSchema, BranchSettingsSchema } from "../src/index";
const profile = {
  businessName: "Mi negocio",
  tradeName: null,
  phone: null,
  email: null,
  website: null,
  ticketFooter: null,
  logoUrl: null,
  timezone: "America/Mexico_City",
  locale: "es-MX",
  currency: "MXN",
};
it("accepts bounded optional identity with explicit operational defaults", () => {
  expect(BusinessProfileSchema.parse(profile)).toEqual(profile);
  expect(
    BusinessProfileSchema.safeParse({
      ...profile,
      email: "shop@example.test",
      website: "https://example.test",
    }).success,
  ).toBe(true);
});
it("rejects currency changes, remote logos, unsupported zones and extra privileges", () => {
  for (const change of [
    { currency: "USD" },
    { logoUrl: "https://example.test/a.png" },
    { timezone: "invalid" },
    { role: "owner" },
  ])
    expect(
      BusinessProfileSchema.safeParse({ ...profile, ...change }).success,
    ).toBe(false);
});
it("rejects oversized text, controls and unsafe URLs", () => {
  for (const change of [
    { businessName: " " },
    { businessName: "a".repeat(121) },
    { phone: "a\nb" },
    { tradeName: "a\u202eb" },
    { website: "javascript:alert(1)" },
    { website: "https://user:pass@example.test" },
    { email: "invalid" },
    { ticketFooter: "a".repeat(501) },
  ])
    expect(
      BusinessProfileSchema.safeParse({ ...profile, ...change }).success,
    ).toBe(false);
});
it("accepts branch presentation and inactive status but rejects identity replacement", () => {
  const b = {
    displayName: "Centro",
    address: null,
    phone: null,
    receiptHeader: "Gracias",
    status: "inactive",
  };
  expect(BranchSettingsSchema.parse(b)).toEqual(b);
  for (const change of [
    { tenantId: "fake" },
    { id: "fake" },
    { displayName: "a".repeat(101) },
    { status: "deleted" },
  ])
    expect(BranchSettingsSchema.safeParse({ ...b, ...change }).success).toBe(
      false,
    );
});

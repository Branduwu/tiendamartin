import { describe, expect, it } from "vitest";
import { companyHref, resolveCompany } from "./company-selection";
import { navigationMember, roleLanding } from "./navigation";

const companies = [
  {
    tenantId: "owner",
    role: "owner",
    permissions: ["reports.read", "products.read"],
  },
  { tenantId: "cashier", role: "cashier", permissions: ["sales.create"] },
  {
    tenantId: "clerk",
    role: "inventory_clerk",
    permissions: ["inventory.read"],
  },
  {
    tenantId: "suspended",
    tenantStatus: "suspended",
    permissions: ["reports.read"],
  },
];
describe("company context preference", () => {
  it("uses an authorized explicit company before remembered context", () => {
    expect(resolveCompany(companies, "cashier", "owner")).toBe("cashier");
  });
  it("never falls back for an unauthorized deep link", () => {
    expect(resolveCompany(companies, "foreign", "owner")).toBe("");
  });
  it("does not select a suspended company", () => {
    expect(resolveCompany(companies, "suspended")).toBe("");
  });
  it("remembers a membership and rejects a forged remembered ID", () => {
    expect(resolveCompany(companies, null, "clerk")).toBe("clerk");
    expect(resolveCompany(companies, null, "foreign")).toBe("owner");
  });
  it("does not substitute another company's permissions", () => {
    expect(
      resolveCompany(
        companies.filter((c) => c.permissions.includes("reports.read")),
        "cashier",
      ),
    ).toBe("");
  });
  it("has no company without memberships", () =>
    expect(resolveCompany([])).toBe(""));
  it.each([
    ["owner", "/dashboard"],
    ["cashier", "/pos"],
    ["clerk", "/inventory"],
  ])("opens the role landing for %s", (id, path) => {
    const next = navigationMember(companies, id);
    expect(companyHref(roleLanding(next), id)).toBe(`${path}?tenantId=${id}`);
  });
  it("switch links carry only the new company, not old resource IDs", () => {
    expect(companyHref("/pos", "new tenant&productId=old")).toBe(
      "/pos?tenantId=new%20tenant%26productId%3Dold",
    );
  });
});

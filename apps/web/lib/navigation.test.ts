import { expect, it } from "vitest";
import {
  navigationGroups,
  navigationMember,
  roleLanding,
  roleLabel,
  canOpenDashboard,
} from "./navigation";
const member = (role: string, permissions: string[]) => ({
  tenantId: "a",
  role,
  permissions,
  tenantStatus: "active",
});
it("denies navigation without permissions and removes empty groups", () => {
  expect(navigationGroups([])).toEqual([]);
  expect(navigationGroups(["products.read"]).map((g) => g.id)).toEqual([
    "inventory",
  ]);
});
it("organizes authorized owner/admin destinations into human groups", () => {
  const groups = navigationGroups([
    "reports.read",
    "products.read",
    "sales.create",
    "members.manage",
  ]);
  expect(groups.map((g) => g.label)).toEqual([
    "Inicio",
    "Vender",
    "Inventario",
    "Configuración",
  ]);
});
it("prioritizes selling for a cashier without inventing administrative access", () => {
  const groups = navigationGroups(
    [
      "products.read",
      "sales.create",
      "cash.read",
      "sales.read",
      "customers.read",
    ],
    "cashier",
  );
  expect(groups[0]?.id).toBe("sell");
  expect(
    groups.flatMap((g) => g.items).some((i) => i.href === "/settings/users"),
  ).toBe(false);
});
it("prioritizes inventory and only permitted purchasing for clerks", () => {
  const groups = navigationGroups(
    ["inventory.read", "products.read", "purchases.read"],
    "inventory_clerk",
  );
  expect(groups.map((g) => g.id)).toEqual(["inventory", "buy"]);
  expect(groups.flatMap((g) => g.items).some((i) => i.href === "/cash")).toBe(
    false,
  );
});
it("includes alerts and labels under their real read permissions", () => {
  expect(
    navigationGroups(["inventory.read", "products.read"])
      .flatMap((g) => g.items)
      .map((i) => i.href),
  ).toEqual(["/products", "/inventory", "/inventory/alerts", "/labels"]);
});
it("never combines memberships or falls back to another company", () => {
  const members = [
    member("owner", ["reports.read"]),
    { ...member("cashier", ["sales.create"]), tenantId: "b" },
  ];
  expect(navigationMember(members, "b")?.permissions).toEqual(["sales.create"]);
  expect(navigationMember(members, "missing")).toBeUndefined();
});
it("routes owner and admin to their authorized dashboard", () => {
  for (const role of ["owner", "admin"])
    expect(roleLanding(member(role, ["reports.read"]))).toBe("/dashboard");
});
it("routes operational roles to their daily work", () => {
  expect(roleLanding(member("cashier", ["sales.create"]))).toBe("/pos");
  expect(roleLanding(member("inventory_clerk", ["inventory.read"]))).toBe(
    "/inventory",
  );
});
it("uses permissions rather than trusting role names and does not accept external paths", () => {
  expect(roleLanding(member("owner", ["products.read"]))).toBe("/products");
  expect(roleLanding(member("https://evil.test", []))).toBe("/onboarding");
  expect(roleLanding()).toBe("/onboarding");
});
it("keeps platform administration outside company navigation", () => {
  expect(
    navigationGroups(["platform.admin", "members.manage"])
      .flatMap((g) => g.items)
      .some((i) => i.href.startsWith("/platform")),
  ).toBe(false);
  expect(roleLabel("cashier")).toBe("Cajero");
});
it("keeps an authorized dashboard available across different company roles", () => {
  const members = [
    member("cashier", ["sales.create"]),
    { ...member("owner", ["reports.read"]), tenantId: "b" },
  ];
  expect(canOpenDashboard(members)).toBe(true);
  expect(
    canOpenDashboard([{ ...members[1]!, tenantStatus: "suspended" }]),
  ).toBe(false);
  expect(canOpenDashboard([members[0]!])).toBe(false);
});

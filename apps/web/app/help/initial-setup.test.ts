import { expect, it } from "vitest";
import type { InitialSetup } from "@smartretail/application";
import { nextSetupStep, setupProgress } from "./initial-setup";
const empty: InitialSetup = {
  company: true,
  branch: false,
  product: false,
  inventory: false,
  cash: false,
  sale: false,
  team: false,
  taxes: false,
};
it.each([
  [{ ...empty, company: false }, "/settings/business"],
  [empty, "/inventory"],
  [{ ...empty, branch: true }, "/products"],
  [{ ...empty, branch: true, product: true }, "/inventory"],
  [{ ...empty, branch: true, product: true, inventory: true }, "/cash"],
  [
    { ...empty, branch: true, product: true, inventory: true, cash: true },
    "/pos",
  ],
] as const)(
  "guides the first missing essential step without creating anything",
  (value, href) => {
    expect(nextSetupStep(value).href).toBe(href);
    expect(nextSetupStep(value).permissions.length).toBeGreaterThan(0);
  },
);
it("optional taxes and team do not block the route to POS", () => {
  expect(
    nextSetupStep({
      ...empty,
      branch: true,
      product: true,
      inventory: true,
      cash: true,
    }).href,
  ).toBe("/pos");
});
it("historical progress must not promise current inventory or an open shift", () => {
  const complete = {
    ...empty,
    branch: true,
    product: true,
    inventory: true,
    cash: true,
    sale: true,
  };
  expect(setupProgress(complete)).toBe(6);
  expect(nextSetupStep(complete).detail).toContain(
    "no la disponibilidad actual",
  );
  expect(nextSetupStep(complete).detail).toContain("turno de caja abierto");
});
it("does not infer product or branch readiness from previous sales", () => {
  expect(nextSetupStep({ ...empty, sale: true, cash: true }).title).toBe(
    "Prepara tu primera sucursal",
  );
});

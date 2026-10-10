import { expect, it } from "vitest";
import {
  helpArticles,
  helpCategories,
  roleGuides,
  searchHelp,
} from "./help-content";
it("covers all eight categories with usable concise task articles", () => {
  expect(new Set(helpArticles.map((a) => a.category)).size).toBe(
    helpCategories.length,
  );
  for (const a of helpArticles) {
    expect(a.steps.length).toBeGreaterThan(0);
    expect(a.problems.length).toBeLessThanOrEqual(5);
  }
});
it("searches title and summary ignoring case and accents", () => {
  expect(searchHelp("CREDITO").some((a) => a.slug === "credit")).toBe(true);
  expect(
    searchHelp("efectivo esperado").some((a) => a.slug === "expected-cash"),
  ).toBe(true);
  expect(searchHelp("zxunknown")).toEqual([]);
});
it("prioritizes relevant permitted destinations without hiding general explanations", () => {
  const results = searchHelp("", ["sales.create"]);
  expect(results[0]?.action?.permission).toBe("sales.create");
  expect(results.some((a) => a.slug === "taxes")).toBe(true);
});
it("keeps related links resolvable and slugs unique", () => {
  expect(new Set(helpArticles.map((a) => a.slug)).size).toBe(
    helpArticles.length,
  );
  for (const a of helpArticles)
    for (const slug of a.related)
      expect(
        slug === "roles" || helpArticles.some((x) => x.slug === slug),
      ).toBe(true);
});
it("separates enterprise owners from platform and documents cashier denials", () => {
  expect(roleGuides.owner.summary).toContain(
    "No es Administrador de SmartRetail",
  );
  expect(roleGuides.cashier.summary).toContain("20%");
  expect(roleGuides.cashier.summary).toContain(
    "No edita productos, hace devoluciones",
  );
  expect(Object.keys(roleGuides)).not.toContain("platform_admin");
});
it("documents explicit scan confirmation and no stock reservation", () => {
  expect(helpArticles.find((a) => a.slug === "scan")?.summary).toContain(
    "Confirma",
  );
  expect(helpArticles.find((a) => a.slug === "suspend")?.summary).toContain(
    "No reserva",
  );
});

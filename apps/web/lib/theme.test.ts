import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { parseTheme, resolvedTheme, THEME_BOOTSTRAP, THEME_KEY } from "./theme";
it("accepts only the three supported preferences", () => {
  expect(["light", "dark", "system"].map(parseTheme)).toEqual([
    "light",
    "dark",
    "system",
  ]);
  for (const value of [null, "invalid", "<script>", {}, 42])
    expect(parseTheme(value)).toBe("system");
});
it("respects the system only when selected", () => {
  expect(resolvedTheme("system", true)).toBe("dark");
  expect(resolvedTheme("system", false)).toBe("light");
  expect(resolvedTheme("light", true)).toBe("light");
  expect(resolvedTheme("dark", false)).toBe("dark");
});
function boot(value: unknown, dark: boolean, blocked = false) {
  const document = { documentElement: { dataset: { theme: "" } } };
  runInNewContext(THEME_BOOTSTRAP, {
    document,
    localStorage: {
      getItem(key: string) {
        expect(key).toBe(THEME_KEY);
        if (blocked) throw new Error("Blocked");
        return value;
      },
    },
    matchMedia: () => ({ matches: dark }),
  });
  return document.documentElement.dataset.theme;
}
it("initializes a saved preference before interactive rendering", () => {
  expect(boot("dark", false)).toBe("dark");
  expect(boot("light", true)).toBe("light");
});
it("falls back safely for invalid or unavailable storage", () => {
  expect(boot("invalid", true)).toBe("dark");
  expect(boot(null, false, true)).toBe("light");
});
it("never treats stored text as script or a CSS value", () => {
  expect(boot("dark;alert(1)", false)).toBe("light");
  expect(THEME_BOOTSTRAP).not.toContain("eval(");
});

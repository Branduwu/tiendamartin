"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  parseTheme,
  resolvedTheme,
  THEME_KEY,
  type Theme,
} from "../../lib/theme";
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [ready, setReady] = useState(false);
  const choice = useRef<Theme>("system");
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      let value: Theme = "system";
      try {
        value = parseTheme(localStorage.getItem(THEME_KEY));
      } catch {
        /* Storage is optional. */
      }
      setTheme(value);
      choice.current = value;
      setReady(true);
      document.documentElement.dataset.theme = resolvedTheme(
        value,
        media.matches,
      );
    };
    const start = setTimeout(sync, 0);
    const mediaChange = () => {
      document.documentElement.dataset.theme = resolvedTheme(
        choice.current,
        media.matches,
      );
    };
    media.addEventListener("change", mediaChange);
    const storageChange = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) sync();
    };
    window.addEventListener("storage", storageChange);
    return () => {
      clearTimeout(start);
      media.removeEventListener("change", mediaChange);
      window.removeEventListener("storage", storageChange);
    };
  }, []);
  return (
    <label className="theme-toggle">
      Tema
      <select
        aria-label="Tema"
        disabled={!ready}
        value={theme}
        onChange={(e) => {
          const value = parseTheme(e.target.value);
          setTheme(value);
          choice.current = value;
          try {
            localStorage.setItem(THEME_KEY, value);
          } catch {
            /* Keep this tab usable. */
          }
          document.documentElement.dataset.theme = resolvedTheme(
            value,
            matchMedia("(prefers-color-scheme: dark)").matches,
          );
        }}
      >
        <option value="system">Sistema</option>
        <option value="light">Claro</option>
        <option value="dark">Oscuro</option>
      </select>
    </label>
  );
}
export function PublicThemeControl() {
  const path = usePathname();
  return ["/login", "/register", "/onboarding", "/invite"].includes(path) ? (
    <header className="public-theme no-print">
      <ThemeToggle />
    </header>
  ) : null;
}

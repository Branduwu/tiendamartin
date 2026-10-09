export type Theme = "light" | "dark" | "system";
export const THEME_KEY = "smartretail.theme.v1";
export function parseTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
export function resolvedTheme(theme: Theme, dark: boolean) {
  return theme === "system" ? (dark ? "dark" : "light") : theme;
}
/** Constant script; no request, user or storage text is interpolated into code. */
export const THEME_BOOTSTRAP = `(()=>{let t="system";try{const v=localStorage.getItem("smartretail.theme.v1");if(v==="light"||v==="dark")t=v}catch{}document.documentElement.dataset.theme=t==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t})()`;

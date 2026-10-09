/** Presentation preference only. Memberships and permissions remain server-authorized. */
type Company = { tenantId: string; tenantStatus?: string };
const key = "smartretail.company.v1";

export function resolveCompany(
  companies: readonly Company[],
  requested?: string | null,
  remembered?: string | null,
): string {
  const active = companies.filter((c) => c.tenantStatus !== "suspended");
  // Explicit links must never silently open another company's resource.
  if (requested)
    return active.find((c) => c.tenantId === requested)?.tenantId ?? "";
  return (
    active.find((c) => c.tenantId === remembered)?.tenantId ??
    active[0]?.tenantId ??
    ""
  );
}

export function selectCompany(
  companies: readonly Company[],
  preferred?: string,
): string {
  let remembered: string | null = null;
  try {
    remembered = sessionStorage.getItem(key);
  } catch {
    /* Storage is optional. */
  }
  const requested =
    preferred ?? new URLSearchParams(window.location.search).get("tenantId");
  return resolveCompany(companies, requested, remembered);
}

export function rememberCompany(tenantId: string) {
  try {
    sessionStorage.setItem(key, tenantId);
  } catch {
    /* Links still carry context. */
  }
}

export function companyHref(path: string, tenantId: string): string {
  return tenantId ? `${path}?tenantId=${encodeURIComponent(tenantId)}` : path;
}

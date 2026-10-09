"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  navigationGroups,
  navigationMember,
  roleLabel,
  type NavigationMembership,
} from "../../lib/navigation";
import AccountControls from "./account-controls";
import MobileNavigation from "./mobile-navigation";
export default function AppNavigation({
  current,
  blocked = false,
  permissions,
  tenantId = "",
  branchName,
}: {
  current: string;
  blocked?: boolean;
  permissions?: readonly string[];
  tenantId?: string;
  branchName?: string | undefined;
}) {
  const [members, setMembers] = useState<NavigationMembership[]>([]);
  const [platform, setPlatform] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/v1/tenants", { signal: c.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return;
        const d: { tenants: NavigationMembership[] } = await r.json();
        if (!c.signal.aborted) setMembers(d.tenants);
      })
      .catch(() => undefined);
    fetch("/api/v1/platform", { signal: c.signal, cache: "no-store" })
      .then((r) => {
        if (!c.signal.aborted) setPlatform(r.ok);
      })
      .catch(() => undefined);
    return () => c.abort();
  }, []);
  const member = navigationMember(members, tenantId);
  const groups = navigationGroups(
    permissions ?? member?.permissions ?? [],
    member?.role,
  );
  const selected = groups.find((g) =>
    g.items.some((i) => i.href === current),
  )?.id;
  const open = expanded ?? selected;
  const suspended = member?.tenantStatus === "suspended";
  const disabled = blocked || suspended;
  const menu = (mobile: boolean) => (
    <nav
      aria-label={mobile ? "Menú móvil" : "Principal"}
      className="grouped-nav"
    >
      {groups.map((group) =>
        group.id === "home" ? (
          <div key={group.id} className="nav-home">
            {disabled ? (
              <span aria-disabled="true">Inicio</span>
            ) : (
              <Link
                prefetch={false}
                href="/dashboard"
                aria-current={current === "/dashboard" ? "page" : undefined}
              >
                Inicio
              </Link>
            )}
          </div>
        ) : (
          <section className="nav-group" key={group.id}>
            <button
              type="button"
              className="nav-group-toggle"
              aria-expanded={open === group.id}
              aria-controls={`${mobile ? "mobile" : "desktop"}-${group.id}`}
              onClick={() => setExpanded(open === group.id ? "" : group.id)}
            >
              <span>{group.label}</span>
              <span aria-hidden="true">{open === group.id ? "−" : "+"}</span>
            </button>
            <ul
              id={`${mobile ? "mobile" : "desktop"}-${group.id}`}
              hidden={open !== group.id}
            >
              {group.items.map((item) => (
                <li key={item.href}>
                  {disabled ? (
                    <span
                      aria-disabled="true"
                      aria-current={current === item.href ? "page" : undefined}
                    >
                      {item.label}
                    </span>
                  ) : (
                    <Link
                      prefetch={false}
                      href={item.href}
                      aria-current={current === item.href ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
      {!groups.length && (
        <p className="muted">
          {member ? "No hay herramientas disponibles." : "Cargando tu acceso…"}
        </p>
      )}
    </nav>
  );
  return (
    <>
      <a className="skip-link" href="#workspace-content">
        Saltar al contenido
      </a>
      <aside
        className="app-sidebar no-print"
        aria-label="Herramientas de la empresa"
      >
        <Link className="brand" href="/onboarding" prefetch={false}>
          SmartRetail
        </Link>
        <p className="sidebar-caption">Tu espacio de trabajo</p>
        {menu(false)}
        {platform && !blocked && (
          <Link className="platform-switch" href="/platform" prefetch={false}>
            Administración de SmartRetail
          </Link>
        )}
      </aside>
      <div className="shell-tools no-print">
        <MobileNavigation>
          {menu(true)}
          {platform && !blocked && (
            <Link href="/platform" prefetch={false}>
              Administración de SmartRetail
            </Link>
          )}
        </MobileNavigation>
        <div className="shell-context">
          <strong>{member?.tenantName ?? "Tu empresa"}</strong>
          {branchName && <span>{branchName}</span>}
          <span>
            {member?.displayName &&
            member.displayName !== roleLabel(member.role)
              ? member.displayName + " · "
              : ""}
            {roleLabel(member?.role)}
          </span>
          {suspended && (
            <span className="error">
              Empresa suspendida. Contacta al administrador.
            </span>
          )}
        </div>
        <AccountControls blocked={blocked} />
      </div>
    </>
  );
}
export function companyLabel(_id: string, index: number, name?: string) {
  return name || `Empresa ${index + 1}`;
}

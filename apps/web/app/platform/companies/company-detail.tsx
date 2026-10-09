"use client";
import { useEffect, useState } from "react";
import { CompanyStatusSchema } from "@smartretail/contracts";
import Link from "next/link";
import type { PlatformCompanyDetail } from "@smartretail/application";
import { purchasingApi } from "../../components/purchasing-client";
export default function CompanyDetail({
  initial,
  actor,
}: {
  initial: PlatformCompanyDetail;
  actor: string;
}) {
  const key = "smartretail.platform-status." + actor + "." + initial.id;
  const [pending, setPending] = useState<{
      commandId: string;
      status: "active" | "suspended";
    } | null>(null),
    [ready, setReady] = useState(false);
  const [company, setCompany] = useState(initial),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const recovery = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const p = CompanyStatusSchema.safeParse(JSON.parse(raw));
          if (p.success) {
            setPending(p.data);
            setConfirm(true);
          } else sessionStorage.removeItem(key);
        }
      } catch {
        setError("No pudimos recuperar el cambio pendiente.");
      }
      setReady(true);
    }, 0);
    return () => clearTimeout(recovery);
  }, [key]);
  async function change() {
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const command = pending ?? {
        commandId: crypto.randomUUID(),
        status:
          company.status === "active"
            ? ("suspended" as const)
            : ("active" as const),
      };
      sessionStorage.setItem(key, JSON.stringify(command));
      setPending(command);
      await purchasingApi(
        "/api/v1/platform/companies/" + company.id,
        undefined,
        {
          method: "PATCH",
          body: JSON.stringify(command),
        },
      );
      setCompany(
        await purchasingApi<PlatformCompanyDetail>(
          "/api/v1/platform/companies/" + company.id,
        ),
      );
      sessionStorage.removeItem(key);
      setPending(null);
      setConfirm(false);
      setNotice("Solicitud confirmada. Se muestra el estado actual.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos actualizar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link href="/platform/companies">Volver a empresas</Link>
      <h1>{company.displayName}</h1>
      <p>
        Origen:{" "}
        {company.origin === "self-service"
          ? "Registro de empresa"
          : "Administración de plataforma"}
      </p>
      <p>Estado: {company.status === "active" ? "Activa" : "Suspendida"}</p>
      <p>
        Alta en plataforma:{" "}
        {new Date(company.createdAt).toLocaleDateString("es-MX", {
          timeZone: "America/Mexico_City",
        })}
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section className="panel stack">
        <h2>Estado de la empresa</h2>
        <p>
          Suspender bloquea la operación normal; conserva datos, usuarios e
          historial.
        </p>
        {confirm ? (
          <>
            <p>
              Confirma{" "}
              {(pending?.status ??
                (company.status === "active" ? "suspended" : "active")) ===
              "suspended"
                ? "la suspensión"
                : "la reactivación"}{" "}
              de {company.displayName}.
            </p>
            <div className="actions">
              <button disabled={busy || !ready} onClick={change}>
                {busy ? "Actualizando..." : "Confirmar cambio de estado"}
              </button>
              <button
                disabled={busy || pending !== null}
                onClick={() => setConfirm(false)}
              >
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <button disabled={!ready} onClick={() => setConfirm(true)}>
            {company.status === "active"
              ? "Suspender empresa"
              : "Reactivar empresa"}
          </button>
        )}
      </section>
      {pending && (
        <p role="status">
          Cambio pendiente: reintenta la misma solicitud para confirmar su
          resultado.
        </p>
      )}
      <section className="panel stack">
        <h2>Resumen operativo</h2>
        <p>
          {company.members.filter((m) => m.status === "active").length} usuarios
          activos de {company.members.length} registrados.
        </p>
        <p>
          {company.branches.filter((b) => b.status === "active").length}{" "}
          sucursales activas de {company.branches.length} registradas.
        </p>
      </section>
      <section className="panel stack">
        <h2>Perfil</h2>
        <p>
          {company.profile?.tradeName ??
            company.profile?.businessName ??
            company.displayName}
        </p>
        <p>Zona horaria: {company.profile?.timezone ?? "Sin perfil"}</p>
        <p>Moneda: {company.profile?.currency ?? "MXN"}</p>
      </section>
      <section className="panel stack">
        <h2>Usuarios ({company.members.length})</h2>
        <p>
          Consulta de memberships. Las contraseñas Auth no se administran aquí.
        </p>
        {company.members.map((m, i) => (
          <p key={i}>
            {m.name} · {m.role} ·{" "}
            {m.status === "active" ? "Activo" : "Inactivo"}
          </p>
        ))}
      </section>
      <section className="panel stack">
        <h2>Sucursales ({company.branches.length})</h2>
        {company.branches.map((b, i) => (
          <p key={i}>
            {b.name} · {b.status === "active" ? "Activa" : "Inactiva"}
          </p>
        ))}
        {!company.branches.length && <p>Sin sucursales registradas.</p>}
      </section>
    </>
  );
}

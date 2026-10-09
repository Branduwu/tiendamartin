"use client";
import { ContextHelp } from "../../components/ui";
import { LoadingLabel } from "../../components/ui";
import { useEffect, useState, type FormEvent } from "react";
import {
  TaxProfileFieldsSchema,
  type TaxProfileDto,
} from "@smartretail/contracts";
import AppNavigation, { companyLabel } from "../../components/app-navigation";
import {
  purchasingApi,
  usePurchasingCompany,
} from "../../components/purchasing-client";
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from "../../../lib/money-input";
export default function TaxesPanel() {
  const company = usePurchasingCompany("taxes.manage");
  const [catalog, setCatalog] = useState<{
    tenant: string;
    profiles: TaxProfileDto[];
  } | null>(null);
  const [editing, setEditing] = useState<TaxProfileDto | null | undefined>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!company.tenantId) return;
    const controller = new AbortController();
    purchasingApi<{ profiles: TaxProfileDto[] }>(
      "/api/v1/taxes",
      company.tenantId,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted)
          setCatalog({ tenant: company.tenantId, profiles: data.profiles });
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setCatalog(null);
          setError(
            e instanceof Error ? e.message : "No pudimos cargar impuestos.",
          );
        }
      });
    return () => controller.abort();
  }, [company.tenantId, revision]);
  const ready = catalog?.tenant === company.tenantId;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const fields = TaxProfileFieldsSchema.parse({
        name: String(form.get("name")),
        rate: decimalToMinorUnits(String(form.get("rate"))),
        active: form.get("active") === "on",
      });
      setBusy(true);
      await purchasingApi(
        "/api/v1/taxes" + (editing ? "/" + editing.id : ""),
        company.tenantId,
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify({
            ...fields,
            ...(editing ? {} : { id: crypto.randomUUID() }),
          }),
        },
      );
      setEditing(undefined);
      setCatalog(null);
      setRevision((r) => r + 1);
      setNotice("Impuesto guardado. Las ventas anteriores conservan su tasa.");
    } catch {
      setError(
        "No pudimos guardar el impuesto. Revisa nombre, tasa entre 0 y 10000% y tu acceso; recarga antes de reintentar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation
          tenantId={company.tenantId}
          current="/settings/taxes"
          permissions={company.permissions}
          blocked={busy}
        />
      </header>
      <main id="workspace-content" tabIndex={-1} className="workspace stack">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Configuración</p>
            <h1>Impuestos</h1>
            <ContextHelp
              label="Impuestos sin CFDI"
              href="/help/taxes"
              keepPage={busy || editing !== undefined}
            >
              El perfil calcula impuestos con la tasa configurada por tu
              negocio. No genera CFDI ni timbrado.
            </ContextHelp>
            <p className="muted">
              SmartRetail usa este perfil para calcular impuestos en la venta.
              Esto no genera una factura fiscal.
            </p>
          </div>
          {ready && editing === undefined && (
            <button
              onClick={() => {
                setError("");
                setNotice("");
                setEditing(null);
              }}
            >
              Crear impuesto
            </button>
          )}
        </div>
        {company.error && (
          <p role="alert" className="error">
            {company.error}
          </p>
        )}
        {!company.loading && !company.tenants.length && (
          <p className="card">No tienes permiso para administrar impuestos.</p>
        )}
        {!!company.tenants.length && (
          <label hidden>
            Empresa
            <select
              disabled={busy || editing !== undefined}
              value={company.tenantId}
              onChange={(e) => {
                setCatalog(null);
                setError("");
                setNotice("");
                company.setTenantId(e.target.value);
              }}
            >
              {company.tenants.map((t, i) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {companyLabel(t.tenantId, i, t.tenantName)}
                </option>
              ))}
            </select>
          </label>
        )}
        {notice && (
          <p role="status" className="success">
            {notice}
          </p>
        )}
        {editing !== undefined && ready && (
          <section className="card">
            <h2>{editing ? "Editar impuesto" : "Nuevo impuesto"}</h2>
            <form className="stack" onSubmit={save}>
              <fieldset className="form-grid" disabled={busy}>
                <label>
                  Nombre
                  <input
                    name="name"
                    required
                    maxLength={120}
                    defaultValue={editing?.name ?? ""}
                    aria-describedby={error ? "tax-error" : undefined}
                  />
                </label>
                <label>
                  Tasa (%)
                  <input
                    name="rate"
                    aria-label="Tasa (%)"
                    required
                    inputMode="decimal"
                    maxLength={16}
                    defaultValue={
                      editing ? minorUnitsToDecimal(editing.rate) : ""
                    }
                    aria-describedby={error ? "tax-help tax-error" : "tax-help"}
                  />
                  <small id="tax-help">
                    Hasta dos decimales. No se selecciona ninguna tasa
                    automáticamente.
                  </small>
                </label>
                <label className="checkbox-label">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={editing?.active ?? true}
                  />
                  Activo
                </label>
              </fieldset>
              {error && (
                <p id="tax-error" role="alert" className="error">
                  {error}
                </p>
              )}
              <div className="actions">
                <button disabled={busy} type="submit">
                  <LoadingLabel busy={busy} label="Guardando…">
                    Guardar impuesto
                  </LoadingLabel>
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    setEditing(undefined);
                    setError("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </section>
        )}
        {editing === undefined && error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!ready && !!company.tenantId && !error && (
          <p role="status">Cargando impuestos…</p>
        )}
        {ready && (
          <section className="card stack" aria-label="Perfiles de impuesto">
            {!catalog?.profiles.length && (
              <p>
                Aún no hay impuestos. Los productos sin perfil muestran «Sin
                impuesto configurado».
              </p>
            )}
            {catalog?.profiles.map((p) => (
              <article key={p.id} className="list-row">
                <div>
                  <h2>{p.name}</h2>
                  <p>
                    {minorUnitsToDecimal(p.rate)}% ·{" "}
                    {p.active ? "Activo" : "Inactivo"}
                  </p>
                </div>
                <button
                  className="secondary"
                  aria-label={`Editar ${p.name}`}
                  disabled={busy || editing !== undefined}
                  onClick={() => {
                    setEditing(p);
                    setError("");
                    setNotice("");
                  }}
                >
                  Editar
                </button>
              </article>
            ))}
          </section>
        )}
      </main>
    </>
  );
}

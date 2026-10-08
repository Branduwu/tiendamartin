"use client";
import { useEffect, useState, type FormEvent } from "react";
import type {
  BusinessProfileDto,
  BranchSettingsInputDto,
} from "@smartretail/contracts";
import AppNavigation from "../../components/app-navigation";
import {
  purchasingApi,
  usePurchasingCompany,
} from "../../components/purchasing-client";
type Branch = BranchSettingsInputDto & {
  id: string;
  name: string;
  code: string;
};
type Settings = { profile: BusinessProfileDto; branches: Branch[] };
const optional = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim() || null;
function Field({
  name,
  label,
  value,
  max = 120,
}: {
  name: string;
  label: string;
  value: string | null;
  max?: number;
}) {
  return (
    <label>
      {label}
      <input name={name} defaultValue={value ?? ""} maxLength={max} />
    </label>
  );
}
function ProfileEditor({
  tenant,
  profile,
  onStarted,
  onSaved,
}: {
  tenant: string;
  profile: BusinessProfileDto;
  onStarted: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    onStarted();
    try {
      await purchasingApi("/api/v1/business", tenant, {
        method: "PUT",
        body: JSON.stringify({
          businessName: String(f.get("businessName") ?? "").trim(),
          tradeName: optional(f, "tradeName"),
          phone: optional(f, "phone"),
          email: optional(f, "email"),
          website: optional(f, "website"),
          ticketFooter: optional(f, "ticketFooter"),
          logoUrl: null,
          timezone: f.get("timezone"),
          locale: f.get("locale"),
          currency: "MXN",
        }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>Negocio</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="stack">
        <Field
          name="businessName"
          label="Nombre del negocio"
          value={profile.businessName}
        />
        <Field
          name="tradeName"
          label="Nombre comercial (opcional)"
          value={profile.tradeName}
        />
        <Field
          name="phone"
          label="Teléfono del negocio (opcional)"
          value={profile.phone}
          max={50}
        />
        <Field
          name="email"
          label="Email del negocio (opcional)"
          value={profile.email}
          max={254}
        />
        <Field
          name="website"
          label="Sitio web (opcional, http o https)"
          value={profile.website}
          max={500}
        />
        <label>
          Zona horaria
          <select name="timezone" defaultValue={profile.timezone}>
            <option value="America/Mexico_City">Ciudad de México</option>
            <option value="America/Tijuana">Tijuana</option>
            <option value="America/Cancun">Cancun</option>
            <option value="America/Hermosillo">Hermosillo</option>
          </select>
        </label>
        <label>
          Formato regional
          <select name="locale" defaultValue={profile.locale}>
            <option value="es-MX">Español (México)</option>
            <option value="en-US">English (US)</option>
          </select>
        </label>
        <p>Moneda: MXN. Los importes existentes conservan su moneda.</p>
        <h2>Ticket</h2>
        <Field
          name="ticketFooter"
          label="Pie del ticket (opcional)"
          value={profile.ticketFooter}
          max={500}
        />
        <p className="muted">
          El nombre comercial aparece en el ticket; si está vacío se usa el
          nombre del negocio. Los datos de identidad impresos usan la
          configuración actual; importes e historial comercial no cambian.
        </p>
        <p className="muted">
          Logo opcional: pendiente de almacenamiento seguro. No se suben
          archivos en esta pantalla.
        </p>
      </fieldset>
      <button disabled={busy}>
        {busy ? "Guardando..." : "Guardar negocio y ticket"}
      </button>
    </form>
  );
}
function BranchEditor({
  tenant,
  branch,
  onStarted,
  onSaved,
}: {
  tenant: string;
  branch: Branch;
  onStarted: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    onStarted();
    try {
      await purchasingApi("/api/v1/business/branches/" + branch.id, tenant, {
        method: "PATCH",
        body: JSON.stringify({
          displayName: optional(f, "displayName"),
          address: optional(f, "address"),
          phone: optional(f, "phone"),
          receiptHeader: optional(f, "receiptHeader"),
          status: f.get("status"),
        }),
      });
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos guardar la sucursal.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="panel stack"
      onSubmit={submit}
      aria-label={"Configurar " + branch.name}
    >
      <h3>{branch.displayName ?? branch.name}</h3>
      <p className="muted">{branch.code}</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset className="stack" disabled={busy}>
        <Field
          name="displayName"
          label="Nombre visible (opcional)"
          value={branch.displayName}
          max={100}
        />
        <Field
          name="address"
          label="Dirección (opcional)"
          value={branch.address}
          max={300}
        />
        <Field
          name="phone"
          label="Teléfono de sucursal (opcional)"
          value={branch.phone}
          max={50}
        />
        <Field
          name="receiptHeader"
          label="Encabezado del ticket (opcional)"
          value={branch.receiptHeader}
          max={300}
        />
        <label>
          Estado
          <select name="status" defaultValue={branch.status}>
            <option value="active">Activa</option>
            <option value="inactive">Inactiva</option>
          </select>
        </label>
      </fieldset>
      <p className="muted">
        Inactiva conserva su historial e impide nuevas ventas, apertura de caja
        y compras.
      </p>
      <button disabled={busy}>
        {busy ? "Guardando..." : "Guardar sucursal"}
      </button>
    </form>
  );
}
function CompanySettings({ tenant }: { tenant: string }) {
  const [loaded, setLoaded] = useState<{ revision: number; value: Settings }>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    purchasingApi<Settings>("/api/v1/business", tenant, { signal: c.signal })
      .then((value) => {
        if (!c.signal.aborted) {
          setLoaded({ revision, value });
          setError("");
        }
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError("No pudimos consultar la configuración. Reintenta.");
      });
    return () => c.abort();
  }, [tenant, revision]);
  const data = loaded?.revision === revision ? loaded.value : undefined;
  const onSaved = () => {
      setNotice("Configuración guardada.");
    },
    onStarted = () => setNotice("");
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
          <button onClick={() => setRevision((n) => n + 1)}>
            Reintentar consulta
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data ? (
        <>
          <ProfileEditor
            key={revision}
            tenant={tenant}
            profile={data.profile}
            onStarted={onStarted}
            onSaved={onSaved}
          />
          <section className="stack">
            <h2>Sucursales</h2>
            <p>
              Se reutilizan las ubicaciones de inventario. Crea nuevas
              ubicaciones desde Inventario.
            </p>
            {data.branches.map((branch) => (
              <BranchEditor
                key={branch.id + ":" + revision}
                tenant={tenant}
                branch={branch}
                onStarted={onStarted}
                onSaved={onSaved}
              />
            ))}
          </section>
        </>
      ) : (
        <p role="status">Cargando configuración...</p>
      )}
    </>
  );
}
export default function BusinessPanel() {
  const company = usePurchasingCompany("settings.manage");
  return (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation
          current="/settings/business"
          permissions={company.permissions}
        />
      </header>
      <main className="workspace stack">
        <h1>Configuración del negocio</h1>
        <p>Identidad comercial, sucursales y datos del ticket.</p>
        {company.error && <p role="alert">{company.error}</p>}
        {company.loading ? (
          <p role="status">Cargando empresas...</p>
        ) : company.tenants.length ? (
          <>
            <label>
              Empresa
              <select
                value={company.tenantId}
                onChange={(e) => company.setTenantId(e.target.value)}
              >
                {company.tenants.map((t, i) => (
                  <option key={t.tenantId} value={t.tenantId}>
                    {"Empresa " + (i + 1)}
                  </option>
                ))}
              </select>
            </label>
            <CompanySettings key={company.tenantId} tenant={company.tenantId} />
          </>
        ) : (
          <p>No tienes permiso para administrar la configuración.</p>
        )}
      </main>
    </>
  );
}

"use client";
import { LoadingLabel } from "../../components/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import SettingsSections from "../../components/settings-sections";
import styles from "../../components/settings-ux.module.css";
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
  section,
  onBusy,
}: {
  tenant: string;
  profile: BusinessProfileDto;
  onStarted: () => void;
  onSaved: () => void;
  section: string;
  onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    onBusy(true);
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
      onBusy(false);
    }
  }
  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>{section === "ticket" ? "Ticket" : "Datos de empresa"}</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="stack">
        <div
          id="business-panel-general"
          role="tabpanel"
          aria-labelledby="business-tab-general"
          className="stack"
          hidden={section !== "general"}
        >
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
          <details className="settings-group">
            <summary>Preferencias</summary>
            <div className="stack">
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
            </div>
          </details>
        </div>
        <div
          id="business-panel-ticket"
          role="tabpanel"
          aria-labelledby="business-tab-ticket"
          className="stack"
          hidden={section !== "ticket"}
        >
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
        </div>
      </fieldset>
      <button disabled={busy}>
        <LoadingLabel busy={busy} label="Guardando...">
          {section === "ticket" ? "Guardar ticket" : "Guardar datos generales"}
        </LoadingLabel>
      </button>
    </form>
  );
}
function BranchEditor({
  tenant,
  branch,
  onStarted,
  onSaved,
  onCancel,
}: {
  tenant: string;
  branch: Branch;
  onStarted: () => void;
  onSaved: (value: BranchSettingsInputDto) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const firstField = useRef<HTMLFormElement>(null),
    sending = useRef(false);
  useEffect(() => {
    firstField.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending.current) return;
    sending.current = true;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    onStarted();
    try {
      const input: BranchSettingsInputDto = {
        displayName: optional(f, "displayName"),
        address: optional(f, "address"),
        phone: optional(f, "phone"),
        receiptHeader: optional(f, "receiptHeader"),
        status: f.get("status") as BranchSettingsInputDto["status"],
      };
      await purchasingApi("/api/v1/business/branches/" + branch.id, tenant, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      onSaved(input);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos guardar la sucursal.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      ref={firstField}
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
      <div className={styles.actions}>
        <button disabled={busy}>
          <LoadingLabel busy={busy} label="Guardando...">
            Guardar sucursal
          </LoadingLabel>
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
function CompanySettings({
  tenant,
  onEditing,
}: {
  tenant: string;
  onEditing: (value: boolean) => void;
}) {
  const [section, setSection] = useState("general"),
    [editing, setEditing] = useState<string>(),
    [search, setSearch] = useState(""),
    [profileBusy, setProfileBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const branchSearch = useRef<HTMLInputElement>(null);
  useEffect(() => {
    onEditing(editing !== undefined || profileBusy);
  }, [editing, profileBusy, onEditing]);
  const closeEditor = () => {
    setEditing(undefined);
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus();
      else branchSearch.current?.focus();
    });
  };
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
      .catch((e: unknown) => {
        if (!c.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "No pudimos consultar la configuración. Reintenta.",
          );
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
          <SettingsSections
            id="business"
            label="Secciones de configuración"
            items={[
              { id: "general", label: "General" },
              { id: "branches", label: "Sucursales" },
              { id: "ticket", label: "Ticket" },
            ]}
            value={section}
            onChange={setSection}
            disabled={editing !== undefined || profileBusy}
          />
          <div hidden={section === "branches"}>
            <ProfileEditor
              key={revision}
              tenant={tenant}
              profile={data.profile}
              onStarted={onStarted}
              onSaved={onSaved}
              section={section}
              onBusy={setProfileBusy}
            />
          </div>
          <section
            id="business-panel-branches"
            role="tabpanel"
            aria-labelledby="business-tab-branches"
            hidden={section !== "branches"}
          >
            <h2>Sucursales</h2>
            <p>
              Se reutilizan las ubicaciones de inventario. Crea nuevas
              ubicaciones desde Inventario.
            </p>
            <label className={styles.branchSearch}>
              Buscar sucursal
              <input
                ref={branchSearch}
                type="search"
                maxLength={100}
                value={search}
                disabled={editing !== undefined}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {!data.branches.length ? (
              <p>
                No hay sucursales. Crea una ubicación desde Inventario si tienes
                permiso.
              </p>
            ) : (
              <ul className={styles.branchList}>
                {data.branches
                  .filter((branch) =>
                    (branch.displayName || branch.name)
                      .toLocaleLowerCase("es-MX")
                      .includes(search.trim().toLocaleLowerCase("es-MX")),
                  )
                  .map((branch) => (
                    <li key={branch.id}>
                      <div className={styles.branchRow}>
                        <div>
                          <strong>{branch.displayName || branch.name}</strong>
                          <p>
                            Ubicación de inventario: {branch.name} ·{" "}
                            {branch.code}
                          </p>
                        </div>
                        <div className={styles.branchActions}>
                          <span
                            className={`badge ${branch.status === "active" ? "active" : ""}`}
                          >
                            {branch.status === "active" ? "Activa" : "Inactiva"}
                          </span>
                          <button
                            type="button"
                            className="secondary"
                            aria-label={`Editar sucursal ${branch.displayName || branch.name}`}
                            disabled={editing !== undefined}
                            onClick={(e) => {
                              trigger.current = e.currentTarget;
                              setEditing(branch.id);
                              onEditing(true);
                              setNotice("");
                            }}
                          >
                            Editar
                          </button>
                        </div>
                      </div>
                      {editing === branch.id && (
                        <BranchEditor
                          key={branch.id + ":" + revision}
                          tenant={tenant}
                          branch={branch}
                          onStarted={onStarted}
                          onSaved={(value) => {
                            setLoaded((current) =>
                              current
                                ? {
                                    ...current,
                                    value: {
                                      ...current.value,
                                      branches: current.value.branches.map(
                                        (b) =>
                                          b.id === branch.id
                                            ? { ...b, ...value }
                                            : b,
                                      ),
                                    },
                                  }
                                : current,
                            );
                            onSaved();
                            closeEditor();
                          }}
                          onCancel={closeEditor}
                        />
                      )}
                    </li>
                  ))}
              </ul>
            )}
            {!!data.branches.length &&
              !data.branches.some((b) =>
                (b.displayName || b.name)
                  .toLocaleLowerCase("es-MX")
                  .includes(search.trim().toLocaleLowerCase("es-MX")),
              ) && (
                <p role="status">
                  No hay coincidencias. Prueba otro nombre o borra la búsqueda.
                </p>
              )}
          </section>
        </>
      ) : !error ? (
        <p role="status">Cargando configuración...</p>
      ) : null}
    </>
  );
}
export default function BusinessPanel() {
  const [editing, setEditing] = useState(false);
  const company = usePurchasingCompany("settings.manage");
  return (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation
          blocked={editing}
          tenantId={company.tenantId}
          current="/settings/business"
          permissions={company.permissions}
        />
      </header>
      <main
        id="workspace-content"
        tabIndex={-1}
        className={`workspace stack ${styles.workspace}`}
      >
        <h1>Configuración del negocio</h1>
        <p>Identidad comercial, sucursales y datos del ticket.</p>
        {company.error && <p role="alert">{company.error}</p>}
        {company.loading ? (
          <p role="status">Cargando empresas...</p>
        ) : company.tenants.length ? (
          <>
            <label hidden>
              Empresa
              <select
                disabled={editing}
                value={company.tenantId}
                onChange={(e) => company.setTenantId(e.target.value)}
              >
                {company.tenants.map((t, i) => (
                  <option key={t.tenantId} value={t.tenantId}>
                    {t.tenantName ?? "Empresa " + (i + 1)}
                    {t.tenantStatus === "suspended" ? " (Suspendida)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <CompanySettings
              key={company.tenantId}
              tenant={company.tenantId}
              onEditing={setEditing}
            />
          </>
        ) : (
          <p>No tienes permiso para administrar la configuración.</p>
        )}
      </main>
    </>
  );
}

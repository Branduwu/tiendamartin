"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CreateSupplierSchema,
  UpdateSupplierSchema,
  type SupplierDto,
} from "@smartretail/contracts";
import AppNavigation, { companyLabel } from "../components/app-navigation";
import {
  purchasingApi,
  PurchasingApiError,
  usePurchasingCompany,
} from "../components/purchasing-client";

export default function SuppliersPanel() {
  const router = useRouter(),
    company = usePurchasingCompany("suppliers.read");
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]),
    [loadedKey, setLoadedKey] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reload, setReload] = useState(0),
    [editor, setEditor] = useState<SupplierDto | null | undefined>(undefined);
  const loadKey = `${company.tenantId}:${reload}`;
  const loading = !!company.tenantId && loadedKey !== loadKey;
  const canWrite = company.permissions.includes("suppliers.write");
  useEffect(() => {
    if (!company.tenantId) return;
    const c = new AbortController();
    purchasingApi<{ suppliers: SupplierDto[] }>(
      "/api/v1/suppliers",
      company.tenantId,
      { signal: c.signal },
    )
      .then((data) => {
        if (!c.signal.aborted) {
          setSuppliers(data.suppliers);
          setLoadedKey(loadKey);
          setEditor(undefined);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(
            e instanceof Error ? e.message : "No pudimos cargar proveedores.",
          );
          setLoadedKey(loadKey);
          setEditor(undefined);
          setSuppliers([]);
          if (e instanceof PurchasingApiError && e.status === 401)
            router.replace("/login");
        }
      });
    return () => c.abort();
  }, [company.tenantId, reload, router, loadKey]);
  async function save(fields: Record<string, unknown>, id: string) {
    setSaving(true);
    setError("");
    try {
      await purchasingApi(
        editor ? `/api/v1/suppliers/${id}` : "/api/v1/suppliers",
        company.tenantId,
        {
          method: editor ? "PATCH" : "POST",
          body: JSON.stringify(editor ? fields : { ...fields, id }),
        },
      );
      setNotice(editor ? "Proveedor actualizado." : "Proveedor creado.");
      setEditor(undefined);
      setReload((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos guardar el proveedor.",
      );
      if (e instanceof PurchasingApiError && e.status === 401)
        router.replace("/login");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation
          tenantId={company.tenantId}
          current="/suppliers"
          blocked={saving}
          permissions={company.permissions}
        />
      </header>
      <main id="workspace-content" tabIndex={-1} className="workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Abastecimiento</p>
            <h1>Proveedores</h1>
            <p className="muted">
              Administra los contactos de compra de tu empresa.
            </p>
          </div>
          <button
            disabled={!canWrite || saving || loading}
            onClick={() => {
              setEditor(null);
              setError("");
              setNotice("");
            }}
          >
            Nuevo proveedor
          </button>
        </div>
        {company.tenants.length > 1 ? (
          <label>
            Empresa
            <select
              value={company.tenantId}
              disabled={saving}
              onChange={(e) => company.setTenantId(e.target.value)}
            >
              {company.tenants.map((t, i) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {companyLabel(t.tenantId, i, t.tenantName)}
                </option>
              ))}
            </select>
          </label>
        ) : company.tenantId ? (
          <p className="muted">Empresa activa</p>
        ) : null}
        {(error || company.error) && (
          <p role="alert" className="error">
            {error || company.error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {(loading || company.loading) && (
          <p role="status" className="card">
            Cargando proveedores…
          </p>
        )}
        {!company.loading && !company.tenantId && (
          <section className="card">
            <p>
              No tienes acceso a proveedores en tus empresas. Consulta al
              administrador.
            </p>
          </section>
        )}
        {editor !== undefined && !loading && (
          <section className="card">
            <h2>{editor ? "Editar proveedor" : "Nuevo proveedor"}</h2>
            <SupplierForm
              key={editor?.id ?? "new"}
              current={editor}
              saving={saving}
              onSave={save}
              onCancel={() => setEditor(undefined)}
            />
          </section>
        )}
        {!loading && company.tenantId && (
          <section className="card">
            <h2>Directorio de proveedores</h2>
            {!canWrite && <p className="muted">Acceso de sólo lectura.</p>}
            {suppliers.length === 0 ? (
              <p>
                Aún no hay proveedores.{" "}
                {canWrite
                  ? "Crea el primero para preparar una orden de compra."
                  : "Solicita a un administrador que agregue uno."}
              </p>
            ) : (
              <div className="responsive-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Proveedor</th>
                      <th>Contacto</th>
                      <th>Teléfono / correo</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s) => (
                      <tr key={s.id}>
                        <th scope="row">
                          {company.permissions.includes("payables.read") ? (
                            <Link
                              href={
                                "/suppliers/" +
                                s.id +
                                "?tenantId=" +
                                company.tenantId
                              }
                            >
                              {s.name}
                            </Link>
                          ) : (
                            s.name
                          )}
                        </th>
                        <td data-label="Contacto">
                          {s.contactName ?? "Sin contacto"}
                        </td>
                        <td data-label="Teléfono / correo">
                          {s.phone ?? "Sin teléfono"}
                          <br />
                          {s.email ?? "Sin correo"}
                        </td>
                        <td data-label="Estado">
                          <span
                            className={
                              s.status === "active" ? "badge" : "badge inactive"
                            }
                          >
                            {s.status === "active" ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                        <td className="row-actions" data-label="Acciones">
                          <button
                            className="secondary"
                            disabled={!canWrite || saving}
                            onClick={() => {
                              setEditor(s);
                              setError("");
                            }}
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
function SupplierForm({
  current,
  saving,
  onSave,
  onCancel,
}: {
  current: SupplierDto | null;
  saving: boolean;
  onSave: (fields: Record<string, unknown>, id: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [id] = useState(() => current?.id ?? crypto.randomUUID()),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    const value: Record<string, unknown> = {
      name: String(form.get("name")),
      status: String(form.get("status")),
    };
    for (const key of ["contactName", "phone", "email", "notes"]) {
      const text = String(form.get(key) ?? "").trim();
      if (text) value[key] = text;
      else if (current) value[key] = null;
    }
    const parsed = current
      ? UpdateSupplierSchema.safeParse(value)
      : CreateSupplierSchema.safeParse({ ...value, id });
    if (!parsed.success) {
      setError("Revisa el nombre, correo y longitud de los campos.");
      return;
    }
    await onSave(value, id);
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label>
        Nombre
        <input
          name="name"
          required
          maxLength={200}
          defaultValue={current?.name ?? ""}
          disabled={saving}
        />
      </label>
      <div className="form-grid">
        <label>
          Persona de contacto
          <input
            name="contactName"
            maxLength={200}
            defaultValue={current?.contactName ?? ""}
            disabled={saving}
          />
        </label>
        <label>
          Teléfono
          <input
            name="phone"
            type="tel"
            maxLength={50}
            defaultValue={current?.phone ?? ""}
            disabled={saving}
          />
        </label>
        <label>
          Correo electrónico
          <input
            name="email"
            type="email"
            maxLength={254}
            defaultValue={current?.email ?? ""}
            disabled={saving}
          />
        </label>
        <label>
          Estado
          <select
            name="status"
            defaultValue={current?.status ?? "active"}
            disabled={saving}
          >
            <option value="active">Activo</option>
            <option value="inactive">Inactivo</option>
          </select>
        </label>
      </div>
      <label>
        Notas
        <textarea
          name="notes"
          maxLength={2000}
          defaultValue={current?.notes ?? ""}
          disabled={saving}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <button disabled={saving}>
          {saving ? "Guardando…" : "Guardar proveedor"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={saving}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

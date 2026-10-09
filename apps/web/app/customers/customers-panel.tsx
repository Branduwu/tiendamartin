"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  CustomerFieldsSchema,
  type CustomerDto,
  type CreateCustomerDto,
  type CustomerSaleDto,
} from "@smartretail/contracts";
import AppNavigation, { companyLabel } from "../components/app-navigation";
import CustomerCredit from "../components/customer-credit";
import { CustomerReceivables } from "../receivables/receivables-panel";
import { formatDateTime } from "../components/presentation";
import {
  purchasingApi,
  usePurchasingCompany,
} from "../components/purchasing-client";
import { minorUnitsToDecimal } from "../../lib/money-input";
type Fields = Omit<CreateCustomerDto, "id">;
export function CustomerForm({
  current,
  saving,
  onSave,
  onCancel,
}: {
  current?: CustomerDto;
  saving: boolean;
  onSave: (value: Fields, id: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [id] = useState(() => current?.id ?? crypto.randomUUID()),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const parsed = CustomerFieldsSchema.safeParse({
      name: text("name"),
      status: text("status"),
      ...(text("phone") ? { phone: text("phone") } : {}),
      ...(text("email") ? { email: text("email") } : {}),
      ...(text("notes") ? { notes: text("notes") } : {}),
    });
    if (!parsed.success) {
      setError("Revisa el nombre y los datos de contacto.");
      return;
    }
    setError("");
    await onSave(parsed.data, id);
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
          {saving ? "Guardando…" : "Guardar cliente"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={onCancel}
          disabled={saving}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
export default function CustomersPanel({
  id,
  preferredTenant,
}: {
  id?: string;
  preferredTenant?: string;
}) {
  const company = usePurchasingCompany("customers.read", preferredTenant),
    canWrite = company.permissions.includes("customers.write");
  const [rows, setRows] = useState<CustomerDto[]>([]),
    [detail, setDetail] = useState<{
      customer: CustomerDto;
      sales: CustomerSaleDto[];
    } | null>(null),
    [search, setSearch] = useState(""),
    [reload, setReload] = useState(0),
    [loaded, setLoaded] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [editor, setEditor] = useState<CustomerDto | null | undefined>(undefined),
    [saving, setSaving] = useState(false);
  const key = company.tenantId + ":" + (id ?? "") + ":" + search + ":" + reload,
    loading = company.loading || loaded !== key;
  useEffect(() => {
    if (!company.tenantId) return;
    const controller = new AbortController(),
      timer = setTimeout(
        () => {
          const path = id
            ? "/api/v1/customers/" + id
            : "/api/v1/customers?q=" + encodeURIComponent(search);
          purchasingApi<{
            customer: CustomerDto;
            sales: CustomerSaleDto[];
            customers: CustomerDto[];
          }>(path, company.tenantId, { signal: controller.signal })
            .then((data) => {
              if (controller.signal.aborted) return;
              setRows(data.customers ?? []);
              setDetail(
                id ? { customer: data.customer, sales: data.sales } : null,
              );
              setError("");
              setLoaded(key);
            })
            .catch((e) => {
              if (controller.signal.aborted) return;
              setRows([]);
              setDetail(null);
              setError(
                e instanceof Error
                  ? e.message
                  : "No pudimos cargar los clientes.",
              );
              setLoaded(key);
            });
        },
        search ? 250 : 0,
      );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [company.tenantId, id, search, key]);
  async function save(value: Fields, customerId: string) {
    setSaving(true);
    setError("");
    try {
      const body = editor
        ? {
            ...value,
            phone: value.phone ?? null,
            email: value.email ?? null,
            notes: value.notes ?? null,
          }
        : { ...value, id: customerId };
      await purchasingApi(
        editor ? "/api/v1/customers/" + customerId : "/api/v1/customers",
        company.tenantId,
        { method: editor ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      setEditor(undefined);
      setNotice(editor ? "Cliente actualizado." : "Cliente creado.");
      setReload((r) => r + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos guardar el cliente.",
      );
    } finally {
      setSaving(false);
    }
  }
  const mxn = (v: string) => "$" + minorUnitsToDecimal(v) + " MXN";
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/products">
          SmartRetail
        </Link>
        <AppNavigation
          tenantId={company.tenantId}
          current="/customers"
          permissions={company.permissions}
        />
      </header>
      <main id="workspace-content" tabIndex={-1} className="workspace">
        <div className="heading">
          <div>
            <h1>{id ? "Cliente" : "Clientes"}</h1>
            <p className="muted">Clientes y sus compras en esta empresa.</p>
          </div>
          <div className="actions">
            {id ? (
              <Link href="/customers">Volver a clientes</Link>
            ) : (
              <button
                disabled={!canWrite || loading || saving}
                onClick={() => {
                  setEditor(null);
                  setError("");
                }}
              >
                Nuevo cliente
              </button>
            )}
          </div>
        </div>
        {!!company.tenants.length && (
          <label>
            Empresa
            <select
              value={company.tenantId}
              disabled={saving}
              onChange={(e) => {
                company.setTenantId(e.target.value);
                setEditor(undefined);
                setNotice("");
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
        {(error || company.error) && (
          <p className="error" role="alert">
            {error || company.error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {company.loading ? (
          <p role="status">Cargando empresas…</p>
        ) : !company.tenants.length ? (
          <p>No tienes permiso para consultar clientes.</p>
        ) : (
          <>
            {editor !== undefined && canWrite && (
              <section className="card">
                <h2>{editor ? "Editar cliente" : "Nuevo cliente"}</h2>
                <CustomerForm
                  key={editor?.id ?? "new"}
                  {...(editor ? { current: editor } : {})}
                  saving={saving}
                  onSave={save}
                  onCancel={() => setEditor(undefined)}
                />
              </section>
            )}
            {!id && (
              <label>
                Buscar clientes
                <input
                  type="search"
                  maxLength={200}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nombre, teléfono o correo"
                />
              </label>
            )}
            {loading ? (
              <p role="status" className="notice">
                Cargando clientes…
              </p>
            ) : id && detail ? (
              <>
                <section className="card">
                  <div className="heading">
                    <h2>{detail.customer.name}</h2>
                    {canWrite && (
                      <button
                        className="secondary"
                        disabled={saving}
                        onClick={() => setEditor(detail.customer)}
                      >
                        Editar cliente
                      </button>
                    )}
                  </div>
                  <p>
                    <span className={"badge " + detail.customer.status}>
                      {detail.customer.status === "active"
                        ? "Activo"
                        : "Inactivo"}
                    </span>
                  </p>
                  {detail.customer.phone && (
                    <p>Teléfono: {detail.customer.phone}</p>
                  )}
                  {detail.customer.email && (
                    <p>Correo: {detail.customer.email}</p>
                  )}
                  {detail.customer.notes && <p>{detail.customer.notes}</p>}
                </section>
                <CustomerCredit
                  customer={detail.customer}
                  tenant={company.tenantId}
                  canManage={company.permissions.includes("credit.manage")}
                  onUpdated={() => setReload((r) => r + 1)}
                />
                {company.permissions.includes("receivables.read") && (
                  <CustomerReceivables
                    key={company.tenantId + detail.customer.id}
                    tenant={company.tenantId}
                    customerId={detail.customer.id}
                  />
                )}
                <section className="card">
                  <h2>Historial de compras</h2>
                  <p className="muted">
                    Últimas 50 ventas asociadas. Las devoluciones conservan la
                    venta original.
                  </p>
                  {!detail.sales.length ? (
                    <p>Aún no hay ventas de este cliente.</p>
                  ) : (
                    <div className="table-shell">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>Total</th>
                            <th>Pago</th>
                            <th>Devoluciones</th>
                            <th>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.sales.map((s) => (
                            <tr key={s.id}>
                              <td data-label="Fecha">
                                {formatDateTime(s.createdAt)}
                              </td>
                              <td data-label="Total">
                                {mxn(s.total.minorUnits)}
                              </td>
                              <td data-label="Pago">
                                {s.paymentMethods
                                  .map((m) =>
                                    m === "cash"
                                      ? "Efectivo"
                                      : m === "credit"
                                        ? "Crédito"
                                        : "Tarjeta",
                                  )
                                  .join(" / ") || "Sin pago"}
                              </td>
                              <td data-label="Devoluciones">
                                {s.returnedTotal.minorUnits === "0"
                                  ? "Sin devoluciones"
                                  : mxn(s.returnedTotal.minorUnits)}
                              </td>
                              <td data-label="Acciones">
                                <Link
                                  href={
                                    "/sales/" +
                                    s.id +
                                    "?tenantId=" +
                                    company.tenantId
                                  }
                                >
                                  Ver ticket
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            ) : !id ? (
              <section className="card">
                <h2>Directorio</h2>
                <p className="muted">
                  Hasta 100 coincidencias; busca para acotar el listado.
                </p>
                {!rows.length ? (
                  <p>No encontramos clientes.</p>
                ) : (
                  <div className="table-shell">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Nombre</th>
                          <th>Contacto</th>
                          <th>Estado</th>
                          <th>Última compra</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((c) => (
                          <tr key={c.id}>
                            <td data-label="Nombre">
                              <strong>{c.name}</strong>
                            </td>
                            <td data-label="Contacto">
                              {c.phone ?? "—"}
                              {c.email && <div>{c.email}</div>}
                            </td>
                            <td data-label="Estado">
                              <span className={"badge " + c.status}>
                                {c.status === "active" ? "Activo" : "Inactivo"}
                              </span>
                            </td>
                            <td data-label="Última compra">
                              {c.lastPurchaseAt
                                ? formatDateTime(c.lastPurchaseAt)
                                : "Sin compras"}
                            </td>
                            <td data-label="Acciones">
                              <div className="actions">
                                <Link
                                  href={
                                    "/customers/" +
                                    c.id +
                                    "?tenantId=" +
                                    company.tenantId
                                  }
                                >
                                  Ver historial
                                </Link>
                                {canWrite && (
                                  <button
                                    className="secondary"
                                    onClick={() => setEditor(c)}
                                    disabled={saving}
                                  >
                                    Editar
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}

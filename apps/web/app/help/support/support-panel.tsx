"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type {
  SupportRequest,
  SupportSummary,
  SupportStatus,
  SupportCategory,
  CreateSupportRequest,
} from "@smartretail/application";
import {
  CreateSupportRequestSchema,
  SupportPagePathSchema,
} from "@smartretail/contracts";
import {
  usePurchasingCompany,
  purchasingApi,
  PurchasingApiError,
} from "../../components/purchasing-client";
import { Button, Dialog, Field } from "../../components/ui";
import { formatDateTime } from "../../components/presentation";
import { roleLabel } from "../../../lib/navigation";
import {
  supportStorage,
  pendingSupport,
  rememberSupport,
  forgetSupport,
  type PendingSupport,
} from "../../../lib/support-pending";
export const supportStatuses: Record<SupportStatus, string> = {
  open: "Abierta",
  in_progress: "En atención",
  resolved: "Resuelta",
  closed: "Cerrada",
};
export const supportCategories: Record<SupportCategory, string> = {
  function: "No puedo usar una función",
  error: "Error",
  billing: "Facturación o cuenta",
  suggestion: "Sugerencia",
  other: "Otro",
};
export const supportFolio = (id: string) =>
  `SR-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
const screens: Record<string, string> = {
  "/help": "Ayuda",
  "/help/support": "Ayuda y soporte",
  "/dashboard": "Inicio y reportes",
  "/products": "Productos",
  "/inventory": "Inventario",
  "/pos": "Punto de venta",
  "/cash": "Caja y turnos",
  "/sales": "Ventas y tickets",
  "/customers": "Clientes",
  "/suppliers": "Proveedores",
  "/purchases": "Compras",
  "/receivables": "Cuentas por cobrar",
  "/payables": "Cuentas por pagar",
  "/expenses": "Gastos",
  "/promotions": "Promociones",
  "/labels": "Etiquetas",
  "/settings/users": "Usuarios",
  "/settings/taxes": "Impuestos",
  "/settings/business": "Negocio y sucursales",
  "/settings/account": "Mi cuenta",
  "/onboarding": "Mis empresas",
};
type Listing = { requests: SupportSummary[]; hasMore: boolean };
export default function SupportPanel({
  platform = false,
}: {
  platform?: boolean;
}) {
  const company = usePurchasingCompany();
  const tenant = platform ? undefined : company.tenantId;
  const [listing, setListing] = useState<{
      key: string;
      value: Listing;
    } | null>(null),
    [detail, setDetail] = useState<SupportRequest | null>(null),
    [page, setPage] = useState(1),
    [filter, setFilter] = useState<SupportStatus | "">(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const [subject, setSubject] = useState(""),
    [description, setDescription] = useState(""),
    [category, setCategory] = useState<SupportCategory>("function"),
    [pagePath, setPagePath] = useState("/help/support");
  const [pending, setPending] = useState<{
    tenant: string;
    value: CreateSupportRequest;
  } | null>(null);
  const [recovery, setRecovery] = useState<PendingSupport | null>(null);
  const [reconciling, setReconciling] = useState(false);
  useEffect(() => {
    if (platform || !tenant) return;
    const saved = pendingSupport(supportStorage());
    if (!saved || saved.tenant !== tenant) return;
    const controller = new AbortController();
    Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return;
        setRecovery(saved);
        setReconciling(true);
        return purchasingApi<SupportRequest>(
          `/api/v1/support/${saved.id}`,
          tenant,
          {
            signal: controller.signal,
          },
        );
      })
      .then((r) => {
        if (controller.signal.aborted || !r) return;
        forgetSupport(supportStorage(), saved);
        setRecovery(null);
        setSubject("");
        setDescription("");
        setDetail(r);
        setNotice(`Solicitud confirmada · ${supportFolio(r.id)}`);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setRecovery(saved);
        setError(
          e instanceof PurchasingApiError && e.status === 404
            ? "Conservamos tu solicitud pendiente. Escribe los mismos datos y reintenta; no se creará otro folio."
            : "No pudimos confirmar la solicitud pendiente. Conservamos su folio para reintentar.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setReconciling(false);
      });
    return () => controller.abort();
  }, [platform, tenant]);
  useEffect(() => {
    if (!pending) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const click = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("a[href]")) {
        e.preventDefault();
        e.stopPropagation();
        setError(
          "Reintenta la solicitud pendiente antes de salir. Su folio se conserva si recargas.",
        );
      }
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("click", click, true);
    };
  }, [pending]);
  const requestKey = `${tenant ?? "platform"}/${page}/${filter}`;
  const base = platform ? "/api/v1/platform/support" : "/api/v1/support";
  useEffect(() => {
    if (!platform && !tenant) return;
    const c = new AbortController();
    purchasingApi<Listing>(
      `${base}?page=${page}${filter ? `&status=${filter}` : ""}`,
      tenant,
      { signal: c.signal },
    )
      .then((value) => {
        if (!c.signal.aborted) {
          setListing({ key: requestKey, value });
          setError("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e instanceof PurchasingApiError
              ? e.message
              : "No pudimos cargar solicitudes.",
          );
      });
    return () => c.abort();
  }, [base, tenant, page, filter, requestKey, reload, platform]);
  async function open(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setDetail(await purchasingApi<SupportRequest>(`${base}/${id}`, tenant));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Solicitud no disponible.");
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || reconciling || !tenant) return;
    const old = pending;
    const saved = pendingSupport(supportStorage());
    if (!old && saved && (!recovery || saved.tenant !== tenant)) {
      setError(
        "Primero confirma la solicitud pendiente en la empresa donde la enviaste.",
      );
      return;
    }
    const input = {
      id:
        old?.tenant === tenant
          ? old.value.id
          : recovery?.tenant === tenant
            ? recovery.id
            : crypto.randomUUID(),
      category,
      subject: subject.trim(),
      description,
      pagePath,
    };
    const p = CreateSupportRequestSchema.safeParse(input);
    if (!p.success) {
      setError(
        "Completa asunto y descripción dentro de los límites indicados.",
      );
      return;
    }
    // Uncertain responses retain an immutable intent and ID, including across retries.
    if (
      old &&
      old.tenant === tenant &&
      JSON.stringify(old.value) !== JSON.stringify(p.data)
    ) {
      setError(
        "La solicitud pendiente conserva sus datos. Reintenta antes de preparar otra.",
      );
      return;
    }
    setPending({ tenant, value: p.data });
    rememberSupport(supportStorage(), { tenant, id: p.data.id });
    setBusy(true);
    setError("");
    try {
      const r = await purchasingApi<SupportRequest>(base, tenant, {
        method: "POST",
        body: JSON.stringify(p.data),
      });
      setPending(null);
      setRecovery(null);
      forgetSupport(supportStorage());
      setSubject("");
      setDescription("");
      setNotice(`Solicitud enviada · ${supportFolio(r.id)}`);
      setDetail(r);
      setPage(1);
      setReload((x) => x + 1);
    } catch (e) {
      if (e instanceof PurchasingApiError && e.status === 409) {
        try {
          const existing = await purchasingApi<SupportRequest>(
            `${base}/${p.data.id}`,
            tenant,
          );
          setPending(null);
          setRecovery(null);
          forgetSupport(supportStorage());
          setDetail(existing);
          setNotice(
            "Esta solicitud ya está registrada. Revisa su contenido original.",
          );
          setReload((x) => x + 1);
          return;
        } catch {
          /* Retain the pointer until its outcome can be confirmed. */
        }
      }
      if (
        e instanceof PurchasingApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 409
      ) {
        setPending(null);
        setRecovery(null);
        forgetSupport(supportStorage());
      }
      setError(
        e instanceof Error
          ? e.message
          : "No pudimos confirmar la solicitud. Reintenta la misma.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function status(value: SupportStatus) {
    if (!detail || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await purchasingApi<SupportRequest>(
        `${base}/${detail.id}`,
        undefined,
        {
          method: "PATCH",
          body: JSON.stringify({ status: value }),
        },
      );
      setDetail((current) => (current?.id === result.id ? result : current));
      setNotice("Estado actualizado.");
      setReload((x) => x + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos actualizar el estado.",
      );
    } finally {
      setBusy(false);
    }
  }
  const rows = listing?.key === requestKey ? listing.value : null;
  return (
    <>
      <div className="heading">
        <div>
          <h1>{platform ? "Soporte de SmartRetail" : "Ayuda y soporte"}</h1>
          <p>
            {platform
              ? "Solicitudes de usuarios. Este acceso no permite operar sus ventas o inventario."
              : "Busca una respuesta en la guía o envía una solicitud. No es un chat."}
          </p>
        </div>
        <Link href="/help">Consultar guías</Link>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {!platform && (
        <>
          {company.loading && <p role="status">Cargando empresas…</p>}
          {company.error && <p role="alert">{company.error}</p>}
          {company.tenants.length > 0 ? (
            <label className="field">
              Empresa
              <select
                disabled={busy}
                value={tenant}
                onChange={(e) => {
                  if (pending) {
                    setError(
                      "Reintenta la solicitud pendiente antes de cambiar de empresa.",
                    );
                    return;
                  }
                  company.setTenantId(e.target.value);
                  setPage(1);
                  setNotice("");
                  setDetail(null);
                }}
              >
                {company.tenants.map((t) => (
                  <option key={t.tenantId} value={t.tenantId}>
                    {t.tenantName || "Tu empresa"}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            !company.loading && (
              <p>
                Necesitas una empresa activa para enviar solicitudes.{" "}
                <Link href="/onboarding">Ver mis empresas</Link>
              </p>
            )
          )}
          {tenant && (
            <form className="panel stack support-form" onSubmit={submit}>
              <h2>Contactar SmartRetail</h2>
              <p>
                No incluyas contraseñas, tokens, datos de pago ni enlaces de
                invitación.
              </p>
              <Field label="Categoría">
                {(props) => (
                  <select
                    {...props}
                    value={category}
                    disabled={busy || !!pending}
                    onChange={(e) =>
                      setCategory(e.target.value as SupportCategory)
                    }
                  >
                    {Object.entries(supportCategories).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Asunto" helper="Máximo 120 caracteres.">
                {(props) => (
                  <input
                    {...props}
                    required
                    maxLength={120}
                    value={subject}
                    disabled={busy || !!pending}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Descripción"
                helper="Qué intentaste hacer y qué ocurrió. Máximo 4000 caracteres."
              >
                {(props) => (
                  <textarea
                    {...props}
                    required
                    maxLength={4000}
                    rows={5}
                    value={description}
                    disabled={busy || !!pending}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Pantalla relacionada">
                {(props) => (
                  <select
                    {...props}
                    value={pagePath}
                    disabled={busy || !!pending}
                    onChange={(e) => setPagePath(e.target.value)}
                  >
                    {SupportPagePathSchema.options.map((path) => (
                      <option key={path} value={path}>
                        {screens[path]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <p className="field-help">
                Se guardarán: empresa seleccionada, tu nombre y rol, pantalla
                elegida y fecha del servidor. No se adjuntan navegador, logs,
                cookies ni otros formularios.
              </p>
              {reconciling && (
                <p role="status">Confirmando tu solicitud anterior…</p>
              )}
              <Button
                type="submit"
                disabled={reconciling}
                busy={busy}
                busyLabel="Enviando…"
              >
                {pending || recovery
                  ? "Reintentar solicitud"
                  : "Enviar solicitud"}
              </Button>
            </form>
          )}
        </>
      )}
      {(platform || tenant) && (
        <section className="panel stack">
          <h2>{platform ? "Bandeja de solicitudes" : "Mis solicitudes"}</h2>
          <label className="field">
            Estado
            <select
              disabled={busy}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as SupportStatus | "");
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {Object.entries(supportStatuses).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {!rows && !error && <p role="status">Cargando solicitudes…</p>}
          {rows && !rows.requests.length && (
            <p>
              Aún no hay solicitudes en esta vista. Puedes consultar las guías o
              enviar una cuando necesites ayuda.
            </p>
          )}
          <ul className="help-articles">
            {rows?.requests.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => open(r.id)}
                >
                  {r.subject}
                </button>
                <p>
                  {supportFolio(r.id)} · {supportStatuses[r.status]} ·{" "}
                  {formatDateTime(r.createdAt)}
                  {platform &&
                    ` · ${r.tenantName} · ${r.createdByName} (${roleLabel(r.createdByRole)})`}
                </p>
              </li>
            ))}
          </ul>
          <div className="actions">
            <Button
              variant="secondary"
              disabled={busy || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span>Página {page}</span>
            <Button
              variant="secondary"
              disabled={busy || !rows?.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </section>
      )}
      <Dialog
        open={!!detail}
        title={detail ? supportFolio(detail.id) : "Solicitud"}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div className="stack">
            <h3>{detail.subject}</h3>
            <p>
              {supportCategories[detail.category]} ·{" "}
              {supportStatuses[detail.status]}
            </p>
            <p className="support-description">{detail.description}</p>
            <p>Empresa: {detail.tenantName}</p>
            <p>
              Usuario: {detail.createdByName} ·{" "}
              {roleLabel(detail.createdByRole)}
            </p>
            <p>Pantalla: {screens[detail.pagePath] ?? "Otra pantalla"}</p>
            <p>Creada: {formatDateTime(detail.createdAt)}</p>
            <p>Actualizada: {formatDateTime(detail.updatedAt)}</p>
            {platform && (
              <label className="field">
                Cambiar estado
                <select
                  disabled={busy}
                  value={detail.status}
                  onChange={(e) => void status(e.target.value as SupportStatus)}
                >
                  {Object.entries(supportStatuses).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

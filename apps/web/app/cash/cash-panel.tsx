"use client";
import { selectCompany } from "../../lib/company-selection";
import AppNavigation, { companyLabel } from "../components/app-navigation";
import { useEffect, useRef, useState } from "react";
import {
  CashHistorySchema,
  type CashHistoryDto,
  CashMovementInputSchema,
  OpenCashShiftSchema,
  CloseCashShiftSchema,
  UuidSchema,
  type CashShiftDto,
  type InventoryLocationDto,
} from "@smartretail/contracts";
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from "../../lib/money-input";
import { formatCashMxn } from "../../lib/cash-display";
import { ContextHelp, LoadingLabel } from "../components/ui";
import { formatDateTime } from "../components/presentation";
type Pending = {
  tenantId: string;
  locationId: string;
  operation: "open" | "movements" | "close";
  data: unknown;
};
const mxn = formatCashMxn;
export default function CashPanel({ userId }: { userId: string }) {
  const key = `smartretail.pending-cash.${userId}`;
  const [memberships, setMemberships] = useState<
    {
      tenantId: string;
      tenantName?: string;
      permissions: string[];
      displayName?: string;
    }[]
  >([]);
  const [tenants, setTenants] = useState<string[]>([]),
    [tenant, setTenant] = useState(""),
    [locations, setLocations] = useState<InventoryLocationDto[]>([]),
    [location, setLocation] = useState("");
  const [shift, setShift] = useState<CashShiftDto | null>(null),
    [opening, setOpening] = useState("0.00"),
    [amount, setAmount] = useState("0.00"),
    [reason, setReason] = useState(""),
    [counted, setCounted] = useState("0.00"),
    [movementType, setMovementType] = useState<"cash_in" | "cash_out">(
      "cash_in",
    );
  const [pending, setPending] = useState<Pending | null>(null),
    [blocked, setBlocked] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [readError, setReadError] = useState("");
  const [refresh, setRefresh] = useState(0),
    [historyRevision, setHistoryRevision] = useState(0);
  const [history, setHistory] = useState<{
    tenantId: string;
    locationId: string;
    value: CashHistoryDto;
  } | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [closePreview, setClosePreview] = useState<{
    shiftId: string;
    minorUnits: string;
  } | null>(null);
  const sending = useRef(false);
  async function load(t: string, l: string, signal?: AbortSignal) {
    const r = await fetch(`/api/v1/cash?locationId=${l}`, {
      headers: { "x-tenant-id": t },
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    return b.shift as CashShiftDto | null;
  }
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const r = await fetch("/api/v1/tenants", { signal: controller.signal });
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        const allowed: string[] = b.tenants
          .filter((t: { permissions: string[] }) =>
            t.permissions.includes("cash.read"),
          )
          .map((t: { tenantId: string }) => t.tenantId);
        if (controller.signal.aborted) return;
        setMemberships(b.tenants);
        setTenants(allowed);
        let selected = selectCompany(
          b.tenants.filter((t: { tenantId: string }) =>
            allowed.includes(t.tenantId),
          ),
        );
        try {
          const saved = sessionStorage.getItem(key);
          if (saved !== null) {
            if (saved.length > 65536) throw new Error();
            const value: unknown = JSON.parse(saved);
            if (
              !value ||
              typeof value !== "object" ||
              Array.isArray(value) ||
              Object.keys(value).length !== 4 ||
              !("tenantId" in value) ||
              !("locationId" in value) ||
              !("operation" in value) ||
              !("data" in value) ||
              typeof value.tenantId !== "string" ||
              !allowed.includes(value.tenantId) ||
              !UuidSchema.safeParse(value.locationId).success
            )
              throw new Error();
            const schema =
              value.operation === "open"
                ? OpenCashShiftSchema
                : value.operation === "movements"
                  ? CashMovementInputSchema
                  : value.operation === "close"
                    ? CloseCashShiftSchema
                    : null;
            const parsed = schema?.safeParse(value.data);
            if (!parsed?.success) throw new Error();
            if ("openingCash" in parsed.data) {
              if (parsed.data.locationId !== value.locationId)
                throw new Error();
              setOpening(
                minorUnitsToDecimal(parsed.data.openingCash.minorUnits),
              );
            } else if ("amount" in parsed.data) {
              setAmount(minorUnitsToDecimal(parsed.data.amount.minorUnits));
              setMovementType(parsed.data.type);
              setReason(parsed.data.reason);
            } else
              setCounted(
                minorUnitsToDecimal(parsed.data.countedCash.minorUnits),
              );
            const recovered = value as Pending;
            setPending(recovered);
            selected = recovered.tenantId;
            setLocation(recovered.locationId);
          }
        } catch {
          setBlocked(true);
          setError(
            "Hay una operación pendiente que no podemos recuperar. Consulta su estado antes de registrar otra.",
          );
        }
        setTenant(selected);
        if (!selected) setLoading(false);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "No se pudo cargar caja.");
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [key]);
  useEffect(() => {
    if (!tenant) return;
    const c = new AbortController();
    fetch("/api/v1/locations", {
      headers: { "x-tenant-id": tenant },
      signal: c.signal,
    })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        if (c.signal.aborted) return;
        setLocations(b.locations);
        if (
          !b.locations.some((v: InventoryLocationDto) => v.status === "active")
        ) {
          setLoading(false);
          setShift(null);
          setLocation("");
        }
        setLocation(
          (old) =>
            old ||
            b.locations.find((v: InventoryLocationDto) => v.status === "active")
              ?.id ||
            "",
        );
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e.message);
          setLoading(false);
          setShift(null);
          setLocations([]);
          setLocation("");
        }
      });
    return () => c.abort();
  }, [tenant]);
  useEffect(() => {
    if (!tenant || !location) return;
    const c = new AbortController();
    load(tenant, location, c.signal)
      .then((value) => {
        if (!c.signal.aborted) {
          setShift(value);
          setReadError("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e.message);
          setReadError(
            "No pudimos consultar el estado del turno. Actualiza la caja antes de operar.",
          );
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [tenant, location, refresh]);
  useEffect(() => {
    if (!tenant || !location) return;
    const c = new AbortController();
    Promise.resolve().then(() => {
      if (!c.signal.aborted) {
        setHistoryLoading(true);
        setHistoryError("");
      }
    });
    fetch(`/api/v1/cash/history?locationId=${location}`, {
      headers: { "x-tenant-id": tenant },
      signal: c.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error();
        const value = CashHistorySchema.parse(b.history);
        if (!c.signal.aborted)
          setHistory({ tenantId: tenant, locationId: location, value });
      })
      .catch(() => {
        if (!c.signal.aborted)
          setHistoryError(
            "No pudimos cargar el historial. Las operaciones de caja se muestran por separado.",
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setHistoryLoading(false);
      });
    return () => c.abort();
  }, [tenant, location, shift, historyRevision]);
  async function submit(operation: Pending["operation"]) {
    if (sending.current || blocked || !location) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = pending ?? {
        tenantId: tenant,
        locationId: location,
        operation,
        data:
          operation === "open"
            ? {
                id: crypto.randomUUID(),
                locationId: location,
                openingCash: {
                  currency: "MXN",
                  minorUnits: decimalToMinorUnits(opening),
                },
              }
            : operation === "movements"
              ? {
                  id: crypto.randomUUID(),
                  shiftId: shift?.id,
                  type: movementType,
                  amount: {
                    currency: "MXN",
                    minorUnits: decimalToMinorUnits(amount),
                  },
                  reason,
                }
              : {
                  shiftId: shift?.id,
                  countedCash: {
                    currency: "MXN",
                    minorUnits: decimalToMinorUnits(counted),
                  },
                },
      };
      const schema =
        value.operation === "open"
          ? OpenCashShiftSchema
          : value.operation === "movements"
            ? CashMovementInputSchema
            : CloseCashShiftSchema;
      if (!schema.safeParse(value.data).success)
        throw new Error("Revisa el importe y el motivo de la operación.");
      sessionStorage.setItem(key, JSON.stringify(value));
      setPending(value);
      const r = await fetch(`/api/v1/cash/${value.operation}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": value.tenantId,
        },
        body: JSON.stringify(value.data),
      });
      const b = await r.json();
      if (!r.ok) {
        if ([400, 404, 409].includes(r.status)) {
          sessionStorage.removeItem(key);
          setPending(null);
        }
        throw new Error(b.error);
      }
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* A stale command never invents a new identity. */
      }
      setPending(null);
      setNotice("Operación confirmada.");
      if (b.shift) setShift(b.shift);
      try {
        setShift(await load(value.tenantId, value.locationId));
      } catch {
        setNotice(
          "Operación confirmada. Actualiza la caja para ver los importes del servidor.",
        );
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Resultado desconocido. Conservamos la operación para consultar o reintentar.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const locked = busy || !!pending || blocked;
  const currentHistory =
    history?.tenantId === tenant && history.locationId === location
      ? history.value
      : null;
  const selectedLocation =
    locations.find((l) => l.id === location)?.name ??
    "Selecciona una ubicación";
  const shiftState = loading
    ? "Consultando turno"
    : readError
      ? "Estado no disponible"
      : !location
        ? "Sin ubicación"
        : shift?.status === "open"
          ? "Caja abierta"
          : shift
            ? "Último turno cerrado"
            : "Sin turno registrado";
  const activeCloseReview =
    closePreview?.shiftId === shift?.id && shift?.status === "open"
      ? closePreview
      : null;
  function refreshCash() {
    setClosePreview(null);
    setLoading(true);
    setReadError("");
    setError("");
    setRefresh((v) => v + 1);
  }
  function reviewClose() {
    try {
      const value = CloseCashShiftSchema.parse({
        shiftId: shift?.id,
        countedCash: {
          currency: "MXN",
          minorUnits: decimalToMinorUnits(counted),
        },
      });
      setClosePreview({
        shiftId: value.shiftId,
        minorUnits: value.countedCash.minorUnits,
      });
      setError("");
    } catch {
      setError(
        "Revisa el efectivo contado: usa un importe no negativo y hasta dos decimales.",
      );
    }
  }
  const errorMessage = [
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
  ].includes(error)
    ? "No pudimos comunicarnos con el servidor. Si hay una operación pendiente, conserva la página y consulta su estado antes de reintentar."
    : error;
  return (
    <>
      <header className="topbar no-print">
        <strong>SmartRetail</strong>
        <AppNavigation
          blocked={locked || loading}
          tenantId={tenant}
          branchName={locations.find((l) => l.id === location)?.name}
          current="/cash"
          permissions={
            memberships.find((t) => t.tenantId === tenant)?.permissions ?? []
          }
        />
      </header>
      <main
        id="workspace-content"
        tabIndex={-1}
        className="workspace cash-workspace"
      >
        <div className="cash-heading">
          <div>
            <h1>Caja</h1>
            <p className="muted">
              Controla el efectivo de tu ubicación, registra movimientos y
              revisa el cierre.
            </p>
          </div>
          <span
            className={`badge ${!loading && !readError && shift?.status === "open" ? "active" : ""}`}
          >
            {shiftState}
          </span>
        </div>
        <p className="company-context">
          Usuario actual:{" "}
          {memberships.find((t) => t.tenantId === tenant)?.displayName ??
            "Cajero registrado"}
        </p>
        {error && (
          <p id="cash-error" role="alert" className="error">
            {errorMessage}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {!tenants.length && !loading ? (
          <p className="card">No tienes permiso para consultar caja.</p>
        ) : (
          <>
            <div className="cash-selectors">
              <label hidden>
                Empresa
                <select
                  aria-label="Empresa"
                  value={tenant}
                  disabled={locked}
                  onChange={(e) => {
                    if (e.target.value === tenant) return;
                    setTenant(e.target.value);
                    setLocation("");
                    setLocations([]);
                    setLoading(true);
                    setShift(null);
                    setClosePreview(null);
                    setReadError("");
                    setError("");
                    setNotice("");
                  }}
                >
                  {tenants.map((t, index) => (
                    <option key={t} value={t}>
                      {companyLabel(
                        t,
                        index,
                        memberships.find((m) => m.tenantId === t)?.tenantName,
                      )}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ubicación
                <select
                  aria-label="Ubicación"
                  value={location}
                  disabled={locked}
                  onChange={(e) => {
                    if (e.target.value === location) return;
                    setLocation(e.target.value);
                    setShift(null);
                    setLoading(Boolean(e.target.value));
                    setReadError("");
                    setClosePreview(null);
                    setError("");
                    setNotice("");
                  }}
                >
                  <option value="">Selecciona una ubicación</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="secondary"
                disabled={busy || !location || loading}
                onClick={refreshCash}
              >
                Actualizar caja
              </button>
            </div>
            {pending && (
              <section role="status" className="cash-pending">
                <strong>
                  {
                    {
                      open: "Apertura",
                      movements: "Movimiento",
                      close: "Cierre",
                    }[pending.operation]
                  }{" "}
                  pendiente de confirmación
                </strong>
                <p>
                  Conservamos la operación y sus IDs para evitar duplicados. No
                  registres otra ni cierres la página hasta resolver el
                  resultado. Si era un cierre, consulta primero el resumen del
                  turno.
                </p>
                <button
                  type="button"
                  disabled={busy || blocked}
                  onClick={() => submit(pending.operation)}
                >
                  <LoadingLabel busy={busy} label="Procesando…">
                    Reintentar operación
                  </LoadingLabel>
                </button>
              </section>
            )}
            {loading ? (
              <p className="card" role="status">
                Cargando caja…
              </p>
            ) : !location ? (
              <p className="card">
                Selecciona una ubicación activa para consultar su caja.
              </p>
            ) : readError ? (
              <section className="card" role="status">
                <h2>Estado no disponible</h2>
                <p>{readError}</p>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={refreshCash}
                >
                  Reintentar consulta
                </button>
              </section>
            ) : (
              <div className="cash-layout">
                <section aria-labelledby="cash-summary-title">
                  <h2 id="cash-summary-title">
                    {shift?.status === "open"
                      ? "Resumen del turno abierto"
                      : shift
                        ? "Resumen del último cierre"
                        : "Prepara tu caja"}
                  </h2>
                  <p className="cash-location">{selectedLocation}</p>
                  {shift ? (
                    <>
                      <dl className="cash-shift-info">
                        <div>
                          <dt>Responsable de apertura</dt>
                          <dd>{shift.openedByName ?? "Cajero registrado"}</dd>
                        </div>
                        <div>
                          <dt>Apertura</dt>
                          <dd>
                            <time dateTime={shift.openedAt}>
                              {formatDateTime(shift.openedAt)}
                            </time>
                          </dd>
                        </div>
                        {shift.status === "closed" && (
                          <>
                            <div>
                              <dt>Responsable de cierre</dt>
                              <dd>
                                {shift.closedByName ?? "Cajero registrado"}
                              </dd>
                            </div>
                            <div>
                              <dt>Cierre</dt>
                              <dd>
                                {shift.closedAt ? (
                                  <time dateTime={shift.closedAt}>
                                    {formatDateTime(shift.closedAt)}
                                  </time>
                                ) : (
                                  "Fecha no disponible"
                                )}
                              </dd>
                            </div>
                          </>
                        )}
                      </dl>
                      <details className="reference">
                        <summary>Referencia del turno</summary>
                        <p className="sale-id">{shift.id}</p>
                        <p className="sale-id">Apertura: {shift.openedBy}</p>
                        {shift.closedBy && (
                          <p className="sale-id">Cierre: {shift.closedBy}</p>
                        )}
                      </details>
                      <dl className="cash-summary">
                        {[
                          ["Fondo inicial", shift.openingCash],
                          ["Ventas en efectivo", shift.salesCash],
                          ["Entradas de efectivo", shift.cashIn],
                          ["Salidas de efectivo", shift.cashOut],
                          ["Efectivo esperado", shift.expectedCash],
                          ["Efectivo contado", shift.countedCash],
                          ["Diferencia", shift.difference],
                        ].map(([label, value]) =>
                          typeof label === "string" ? (
                            <div
                              key={label}
                              className={
                                label === "Efectivo esperado"
                                  ? "cash-highlight"
                                  : label === "Diferencia"
                                    ? "cash-difference"
                                    : undefined
                              }
                            >
                              <dt>{label}</dt>
                              <dd>
                                {value && typeof value === "object" ? (
                                  <>
                                    {mxn(value.minorUnits)}
                                    {label === "Diferencia" && (
                                      <small>
                                        {BigInt(value.minorUnits) < 0n
                                          ? "Faltante"
                                          : BigInt(value.minorUnits) > 0n
                                            ? "Sobrante"
                                            : "Sin diferencia"}
                                      </small>
                                    )}
                                  </>
                                ) : (
                                  <span className="muted">
                                    {shift.status === "open"
                                      ? "Se registra al cerrar"
                                      : "No disponible"}
                                  </span>
                                )}
                              </dd>
                            </div>
                          ) : null,
                        )}
                      </dl>
                      <ContextHelp
                        label="Dinero esperado"
                        href="/help/expected-cash"
                        keepPage
                      >
                        El efectivo esperado incluye fondo, ventas y entradas,
                        menos salidas registradas, como reembolsos y gastos.
                        Tarjetas y deuda a crédito no son efectivo físico.
                      </ContextHelp>
                    </>
                  ) : (
                    <p className="muted">
                      No hay un turno registrado en esta ubicación. Abre la caja
                      con el fondo de efectivo que tengas físicamente.
                    </p>
                  )}
                </section>
                <section
                  className="cash-actions"
                  aria-label="Operaciones de caja"
                >
                  {shift?.status !== "open" ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        submit("open");
                      }}
                    >
                      <h2>{shift ? "Abrir nuevo turno" : "Abrir turno"}</h2>
                      <p className="muted">
                        Registra únicamente el efectivo inicial. El cierre
                        anterior se conserva.
                      </p>
                      <label>
                        Fondo inicial (MXN)
                        <input
                          aria-describedby="opening-help cash-error"
                          value={opening}
                          disabled={locked}
                          inputMode="decimal"
                          onChange={(e) => setOpening(e.target.value)}
                        />
                      </label>
                      <small id="opening-help">
                        Importe no negativo, con hasta dos decimales. Puede ser
                        cero.
                      </small>
                      <button disabled={locked || !location} aria-busy={busy}>
                        <LoadingLabel busy={busy} label="Abriendo…">
                          Abrir caja
                        </LoadingLabel>
                      </button>
                    </form>
                  ) : (
                    <>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          setClosePreview(null);
                          submit("movements");
                        }}
                      >
                        <h2>Movimiento de efectivo</h2>
                        <label>
                          Tipo
                          <select
                            aria-label="Tipo de movimiento"
                            value={movementType}
                            disabled={locked}
                            onChange={(e) =>
                              setMovementType(
                                e.target.value as "cash_in" | "cash_out",
                              )
                            }
                          >
                            <option value="cash_in">
                              Ingreso · entrada de dinero
                            </option>
                            <option value="cash_out">
                              Retiro · salida de dinero
                            </option>
                          </select>
                        </label>
                        <p className="cash-movement-description">
                          {movementType === "cash_in"
                            ? "Ingreso: dinero que entra físicamente a la caja."
                            : "Retiro: dinero que sale físicamente de la caja. El servidor valida el efectivo disponible."}
                        </p>
                        <label>
                          Importe (MXN)
                          <input
                            aria-describedby="movement-help cash-error"
                            value={amount}
                            disabled={locked}
                            inputMode="decimal"
                            onChange={(e) => setAmount(e.target.value)}
                          />
                        </label>
                        <label>
                          Motivo
                          <input
                            aria-describedby="movement-help cash-error"
                            value={reason}
                            disabled={locked}
                            maxLength={200}
                            placeholder={
                              movementType === "cash_in"
                                ? "Ej. reposición de fondo"
                                : "Ej. retiro para depósito"
                            }
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </label>
                        <small id="movement-help">
                          Importe mayor a cero, hasta dos decimales y un motivo
                          sin espacios al principio o al final.
                        </small>
                        <button disabled={locked} aria-busy={busy}>
                          <LoadingLabel busy={busy} label="Registrando…">
                            {movementType === "cash_in"
                              ? "Registrar ingreso"
                              : "Registrar retiro"}
                          </LoadingLabel>
                        </button>
                      </form>
                      <form
                        className="cash-close-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          reviewClose();
                        }}
                      >
                        <h2>Cerrar turno</h2>
                        <p className="muted">
                          Cuenta el efectivo físico antes de cerrar. No se
                          ajustan automáticamente los movimientos.
                        </p>
                        <label>
                          Efectivo contado (MXN)
                          <input
                            aria-describedby="counted-help cash-error"
                            value={counted}
                            disabled={locked || activeCloseReview !== null}
                            inputMode="decimal"
                            onChange={(e) => setCounted(e.target.value)}
                          />
                        </label>
                        <small id="counted-help">
                          El servidor guardará el cierre y calculará la
                          diferencia. Puede existir un faltante o sobrante.
                        </small>
                        {activeCloseReview === null ? (
                          <button
                            className="danger"
                            disabled={locked}
                            aria-busy={busy}
                          >
                            Revisar cierre
                          </button>
                        ) : (
                          <section
                            className="cash-close-review"
                            aria-label="Confirmar cierre"
                          >
                            <h3>Revisa antes de cerrar</h3>
                            <dl>
                              <div>
                                <dt>Ubicación</dt>
                                <dd>{selectedLocation}</dd>
                              </div>
                              <div>
                                <dt>Efectivo esperado consultado</dt>
                                <dd>{mxn(shift.expectedCash.minorUnits)}</dd>
                              </div>
                              <div>
                                <dt>Efectivo contado</dt>
                                <dd>{mxn(activeCloseReview.minorUnits)}</dd>
                              </div>
                            </dl>
                            <p>
                              El cierre se registra en el servidor y conserva la
                              diferencia. Confirma sólo si terminaste el conteo.
                            </p>
                            <div className="cash-review-actions">
                              <button
                                type="button"
                                className="secondary"
                                disabled={locked}
                                onClick={() => setClosePreview(null)}
                              >
                                Volver a editar
                              </button>
                              <button
                                type="button"
                                className="danger"
                                disabled={locked}
                                aria-busy={busy}
                                onClick={() => {
                                  setClosePreview(null);
                                  submit("close");
                                }}
                              >
                                <LoadingLabel busy={busy} label="Cerrando…">
                                  Confirmar cierre
                                </LoadingLabel>
                              </button>
                            </div>
                          </section>
                        )}
                      </form>
                    </>
                  )}
                </section>
              </div>
            )}
            {!!location && (
              <section
                className="cash-history"
                aria-labelledby="cash-history-title"
              >
                <div className="cash-history-heading">
                  <div>
                    <h2 id="cash-history-title">
                      Historial reciente de esta ubicación
                    </h2>
                    <p className="muted">
                      Hasta 10 turnos y 20 movimientos, del más reciente al más
                      antiguo. No es el historial completo.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={historyLoading || busy}
                    onClick={() => setHistoryRevision((v) => v + 1)}
                  >
                    Actualizar historial
                  </button>
                </div>
                {historyLoading ? (
                  <p role="status">Cargando historial…</p>
                ) : historyError ? (
                  <p role="status" className="notice">
                    {historyError}
                  </p>
                ) : currentHistory ? (
                  <>
                    <h3>Movimientos recientes</h3>
                    {!currentHistory.movements.length ? (
                      <p className="card muted">
                        No hay movimientos registrados en esta ubicación.
                      </p>
                    ) : (
                      <div className="table-scroll responsive-table">
                        <table className="data-table cash-history-table">
                          <caption>Entradas y salidas registradas</caption>
                          <thead>
                            <tr>
                              <th scope="col">Fecha</th>
                              <th scope="col">Movimiento y concepto</th>
                              <th scope="col">Importe MXN</th>
                              <th scope="col">Referencias</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentHistory.movements.map((m) => (
                              <tr key={m.id}>
                                <td data-label="Fecha">
                                  <time dateTime={m.createdAt}>
                                    {formatDateTime(m.createdAt)}
                                  </time>
                                </td>
                                <td data-label="Movimiento y concepto">
                                  <strong>
                                    {m.type === "cash_in"
                                      ? "Ingreso"
                                      : "Retiro"}
                                  </strong>
                                  <p>{m.reason}</p>
                                </td>
                                <td data-label="Importe MXN" className="amount">
                                  {m.type === "cash_in" ? "+" : "−"}
                                  {mxn(m.amount.minorUnits)}
                                </td>
                                <td data-label="Referencias">
                                  <details className="reference">
                                    <summary>Ver referencias</summary>
                                    <p className="sale-id">
                                      Movimiento: {m.id}
                                    </p>
                                    <p className="sale-id">
                                      Turno: {m.shiftId}
                                    </p>
                                    <p className="sale-id">
                                      Registrado por: {m.createdBy}
                                    </p>
                                  </details>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <h3>Turnos recientes</h3>
                    {!currentHistory.shifts.length ? (
                      <p className="card muted">
                        No hay turnos registrados en esta ubicación.
                      </p>
                    ) : (
                      <div className="table-scroll responsive-table">
                        <table className="data-table cash-history-table">
                          <caption>Aperturas y cierres registrados</caption>
                          <thead>
                            <tr>
                              <th scope="col">Apertura</th>
                              <th scope="col">Responsable y estado</th>
                              <th scope="col">Fondo inicial</th>
                              <th scope="col">Cierre y diferencia</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentHistory.shifts.map((s) => (
                              <tr key={s.id}>
                                <td data-label="Apertura">
                                  <time dateTime={s.openedAt}>
                                    {formatDateTime(s.openedAt)}
                                  </time>
                                  <details className="reference">
                                    <summary>Referencia</summary>
                                    <span className="sale-id">{s.id}</span>
                                  </details>
                                </td>
                                <td data-label="Responsable y estado">
                                  <strong>
                                    {s.openedByName ?? "Cajero registrado"}
                                  </strong>
                                  <p>
                                    {s.status === "open"
                                      ? "Abierto"
                                      : "Cerrado"}
                                  </p>
                                </td>
                                <td
                                  data-label="Fondo inicial"
                                  className="amount"
                                >
                                  {mxn(s.openingCash.minorUnits)}
                                </td>
                                <td data-label="Cierre y diferencia">
                                  {s.status === "open" ? (
                                    "Pendiente de cierre"
                                  ) : (
                                    <>
                                      {s.closedAt && (
                                        <time dateTime={s.closedAt}>
                                          {formatDateTime(s.closedAt)}
                                        </time>
                                      )}
                                      <p>
                                        Contado:{" "}
                                        {s.countedCash
                                          ? mxn(s.countedCash.minorUnits)
                                          : "No disponible"}
                                      </p>
                                      <p>
                                        Diferencia:{" "}
                                        {s.difference
                                          ? mxn(s.difference.minorUnits)
                                          : "No disponible"}
                                      </p>
                                    </>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                ) : (
                  <p role="status">Preparando historial…</p>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

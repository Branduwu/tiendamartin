"use client";
import { selectCompany } from "../../lib/company-selection";
import AppNavigation, { companyLabel } from "../components/app-navigation";
import { useEffect, useRef, useState } from "react";
import {
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
        if (!c.signal.aborted) setShift(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [tenant, location]);
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
      <main id="workspace-content" tabIndex={-1} className="workspace">
        <h1>Caja</h1>
        <p className="company-context">
          Cajero actual:{" "}
          {memberships.find((t) => t.tenantId === tenant)?.displayName ??
            "Cajero registrado"}
        </p>
        <p className="muted">
          Abre el turno, registra ingresos y retiros, y compara el efectivo al
          cerrar.
        </p>
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
        {!tenants.length && !loading ? (
          <p>No tienes permiso para consultar caja.</p>
        ) : (
          <>
            <div className="pos-selectors">
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
            </div>
            {pending && (
              <section role="status">
                <p>
                  Operación pendiente: {pending.operation}. Conservamos sus IDs
                  para evitar duplicados. Si era un cierre, consulta primero el
                  resumen del turno.
                </p>
                <button
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
              <p>Cargando caja…</p>
            ) : (
              <div className="cash-layout">
                <section>
                  <h2>
                    {shift?.status === "open"
                      ? "Turno abierto"
                      : shift
                        ? "Turno cerrado"
                        : "Sin turno"}
                  </h2>
                  {shift && (
                    <>
                      <details className="reference">
                        <summary>Referencia del turno</summary>
                        <p className="sale-id">{shift.id}</p>
                      </details>
                      <p>Inicio: {formatDateTime(shift.openedAt)}</p>
                      <p>
                        Abierto por:{" "}
                        {"openedByName" in shift &&
                        typeof shift.openedByName === "string"
                          ? shift.openedByName
                          : "Cajero registrado"}
                      </p>
                      {shift.status === "closed" && (
                        <p>
                          Cerrado por:{" "}
                          {"closedByName" in shift &&
                          typeof shift.closedByName === "string"
                            ? shift.closedByName
                            : "Cajero registrado"}
                        </p>
                      )}
                      <dl className="cash-summary">
                        {[
                          ["Fondo inicial", shift.openingCash],
                          ["Ventas en efectivo", shift.salesCash],
                          ["Ingresos", shift.cashIn],
                          ["Retiros", shift.cashOut],
                          ["Efectivo esperado", shift.expectedCash],
                          ["Efectivo contado", shift.countedCash],
                          ["Diferencia", shift.difference],
                        ].map(([label, value]) =>
                          typeof label === "string" &&
                          value &&
                          typeof value === "object" ? (
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
                              <dt>
                                {label}
                                {label === "Efectivo esperado" && (
                                  <ContextHelp
                                    label="Dinero esperado"
                                    href="/help/expected-cash"
                                    keepPage
                                  >
                                    Es el efectivo inicial más ventas y entradas
                                    en efectivo, menos salidas, incluidos
                                    reembolsos y gastos en efectivo. Tarjetas y
                                    deuda a crédito no son efectivo en caja.
                                  </ContextHelp>
                                )}
                              </dt>
                              <dd>
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
                              </dd>
                            </div>
                          ) : null,
                        )}
                      </dl>
                      <p>
                        Las ventas con tarjeta no aumentan el efectivo físico.
                      </p>
                    </>
                  )}
                  <button
                    className="secondary"
                    disabled={busy || !location}
                    onClick={() =>
                      load(tenant, location)
                        .then(setShift)
                        .catch((e) => setError(e.message))
                    }
                  >
                    Actualizar caja
                  </button>
                </section>
                <section className="cash-actions">
                  {shift?.status !== "open" ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        submit("open");
                      }}
                    >
                      <h2>{shift ? "Abrir nuevo turno" : "Abrir turno"}</h2>
                      <label>
                        Fondo inicial (MXN)
                        <input
                          value={opening}
                          disabled={locked}
                          inputMode="decimal"
                          onChange={(e) => setOpening(e.target.value)}
                        />
                      </label>
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
                            <option value="cash_in">Ingreso</option>
                            <option value="cash_out">Retiro</option>
                          </select>
                        </label>
                        <label>
                          Importe (MXN)
                          <input
                            value={amount}
                            disabled={locked}
                            inputMode="decimal"
                            onChange={(e) => setAmount(e.target.value)}
                          />
                        </label>
                        <label>
                          Motivo
                          <input
                            value={reason}
                            disabled={locked}
                            maxLength={200}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </label>
                        <button disabled={locked} aria-busy={busy}>
                          <LoadingLabel busy={busy} label="Registrando…">
                            Registrar movimiento
                          </LoadingLabel>
                        </button>
                      </form>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          submit("close");
                        }}
                      >
                        <h2>Cerrar turno</h2>
                        <label>
                          Efectivo contado (MXN)
                          <input
                            value={counted}
                            disabled={locked}
                            inputMode="decimal"
                            onChange={(e) => setCounted(e.target.value)}
                          />
                        </label>
                        <ContextHelp
                          label="Diferencia al cerrar caja"
                          href="/help/cash-difference"
                          keepPage
                        >
                          Se conserva la diferencia entre efectivo esperado y
                          contado. Los movimientos registrados no se ajustan
                          automáticamente.
                        </ContextHelp>
                        <button
                          className="danger"
                          disabled={locked}
                          aria-busy={busy}
                        >
                          <LoadingLabel busy={busy} label="Cerrando…">
                            Cerrar caja
                          </LoadingLabel>
                        </button>
                      </form>
                    </>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

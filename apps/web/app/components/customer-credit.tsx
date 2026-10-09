"use client";
import { ContextHelp } from "./ui";
import { useEffect, useState, type FormEvent } from "react";
import type { CustomerDto } from "@smartretail/contracts";
import { purchasingApi } from "./purchasing-client";
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from "../../lib/money-input";
export default function CustomerCredit({
  customer,
  tenant,
  canManage,
  onUpdated,
}: {
  customer: CustomerDto;
  tenant: string;
  canManage: boolean;
  onUpdated: () => void;
}) {
  const [outstanding, setOutstanding] = useState<string | null>(null),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    purchasingApi<{ outstandingAmount: { minorUnits: string } }>(
      `/api/v1/customers/${customer.id}/credit`,
      tenant,
      { signal: controller.signal },
    )
      .then((r) => {
        if (!controller.signal.aborted)
          setOutstanding(r.outstandingAmount.minorUnits);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("No pudimos consultar el saldo de crédito.");
      });
    return () => controller.abort();
  }, [tenant, customer]);
  const mxn = (v: string) => "$" + minorUnitsToDecimal(v) + " MXN";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const limit = String(form.get("limit") ?? "").trim();
      await purchasingApi(`/api/v1/customers/${customer.id}`, tenant, {
        method: "PATCH",
        body: JSON.stringify({
          creditEnabled: form.get("enabled") === "on",
          creditLimit: limit
            ? { currency: "MXN", minorUnits: decimalToMinorUnits(limit) }
            : null,
        }),
      });
      setEditing(false);
      onUpdated();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos configurar el crédito.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="card">
      <div className="heading">
        <h2>Crédito del cliente</h2>
        {canManage && !editing && (
          <button className="secondary" onClick={() => setEditing(true)}>
            Configurar crédito
          </button>
        )}
      </div>
      <p>
        {customer.creditEnabled
          ? "Crédito habilitado"
          : "Crédito deshabilitado"}
      </p>
      <p>
        Límite:{" "}
        <strong>
          {customer.creditLimit
            ? mxn(customer.creditLimit.minorUnits)
            : "Sin límite configurado"}
        </strong>
      </p>
      <p>
        Saldo pendiente (todas las sucursales):{" "}
        <strong>
          {outstanding === null ? "Consultando…" : mxn(outstanding)}
        </strong>
      </p>
      {outstanding !== null && customer.creditLimit && (
        <p>
          Disponible:{" "}
          {mxn(
            (BigInt(customer.creditLimit.minorUnits) > BigInt(outstanding)
              ? BigInt(customer.creditLimit.minorUnits) - BigInt(outstanding)
              : 0n
            ).toString(),
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {editing && canManage && (
        <form className="stack" onSubmit={submit}>
          <ContextHelp
            label="Límite de crédito"
            href="/help/credit"
            keepPage={saving || editing}
          >
            Controla cuánto puede adeudar el cliente en nuevas ventas. Si lo
            dejas vacío, no hay límite configurado; los adeudos anteriores se
            conservan.
          </ContextHelp>
          <label>
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={customer.creditEnabled ?? false}
              disabled={saving}
            />{" "}
            Habilitar crédito
          </label>
          <label>
            Límite de crédito (MXN, opcional)
            <input
              name="limit"
              inputMode="decimal"
              defaultValue={
                customer.creditLimit
                  ? minorUnitsToDecimal(customer.creditLimit.minorUnits)
                  : ""
              }
              maxLength={30}
              disabled={saving}
            />
          </label>
          <p className="muted">
            Dejar vacío permite crédito sin límite configurado. Reducir el
            límite o deshabilitar crédito sólo afecta nuevas ventas; las cuentas
            existentes se pueden cobrar.
          </p>
          <div className="actions">
            <button disabled={saving}>Guardar crédito</button>
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

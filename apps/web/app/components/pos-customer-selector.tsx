"use client";
import { useEffect, useState } from "react";
import type { CustomerDto, CreateCustomerDto } from "@smartretail/contracts";
import { CustomerForm } from "../customers/customers-panel";
import { purchasingApi } from "./purchasing-client";
export default function PosCustomerSelector({
  tenantId,
  value,
  locked,
  canRead,
  canWrite,
  onSelect,
}: {
  tenantId: string;
  value: string | undefined;
  locked: boolean;
  canRead: boolean;
  canWrite: boolean;
  onSelect: (id?: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [rows, setRows] = useState<CustomerDto[]>([]),
    [known, setKnown] = useState<Record<string, CustomerDto>>({}),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false),
    [saving, setSaving] = useState(false),
    [loaded, setLoaded] = useState("");
  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController(),
      timer = setTimeout(() => {
        purchasingApi<{ customers: CustomerDto[] }>(
          "/api/v1/customers?q=" + encodeURIComponent(query),
          tenantId,
          { signal: controller.signal },
        )
          .then((data) => {
            if (controller.signal.aborted) return;
            setRows(data.customers);
            setKnown((old) => ({
              ...old,
              ...Object.fromEntries(data.customers.map((c) => [c.id, c])),
            }));
            setError("");
            setLoaded(query);
          })
          .catch((e) => {
            if (!controller.signal.aborted) {
              setRows([]);
              setError(
                e instanceof Error ? e.message : "No pudimos buscar clientes.",
              );
              setLoaded(query);
            }
          });
      }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [canRead, query, tenantId]);
  useEffect(() => {
    if (!value || known[value] || !canRead) return;
    const controller = new AbortController();
    purchasingApi<{ customer: CustomerDto }>(
      "/api/v1/customers/" + value,
      tenantId,
      { signal: controller.signal },
    )
      .then(({ customer }) => {
        if (!controller.signal.aborted)
          setKnown((old) => ({ ...old, [customer.id]: customer }));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "No pudimos cargar el nombre del cliente seleccionado. Conservamos su referencia.",
          );
      });
    return () => controller.abort();
  }, [value, known, tenantId, canRead]);
  async function create(fields: Omit<CreateCustomerDto, "id">, id: string) {
    setSaving(true);
    try {
      const { customer } = await purchasingApi<{ customer: CustomerDto }>(
        "/api/v1/customers",
        tenantId,
        { method: "POST", body: JSON.stringify({ ...fields, id }) },
      );
      setKnown((old) => ({ ...old, [customer.id]: customer }));
      setRows((old) => [customer, ...old.filter((c) => c.id !== id)]);
      if (customer.status === "active") onSelect(customer.id);
      setCreating(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos crear el cliente.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="card" aria-labelledby="pos-customer-title">
      <div className="heading">
        <div>
          <h2 id="pos-customer-title">Cliente de la venta</h2>
          <p>
            <strong>
              {value
                ? (known[value]?.name ?? "Cliente seleccionado")
                : "Público general"}
            </strong>
          </p>
        </div>
        <div className="actions">
          {value && (
            <button
              type="button"
              className="secondary"
              disabled={locked || saving}
              onClick={() => onSelect()}
            >
              Quitar cliente
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              className="secondary"
              disabled={locked || saving}
              onClick={() => setCreating(true)}
            >
              Crear cliente rápido
            </button>
          )}
        </div>
      </div>
      <p className="muted">
        Opcional: puedes completar la venta como Público general.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {creating && canWrite ? (
        <CustomerForm
          saving={saving || locked}
          onSave={create}
          onCancel={() => setCreating(false)}
        />
      ) : canRead ? (
        <>
          <label>
            Buscar cliente para esta venta
            <input
              type="search"
              value={query}
              maxLength={200}
              disabled={locked || saving}
              placeholder="Nombre, teléfono o correo"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {loaded !== query ? (
            <p role="status">Buscando clientes…</p>
          ) : rows.length ? (
            <ul className="customer-results">
              {rows.map((c) => (
                <li key={c.id}>
                  <div>
                    <strong>{c.name}</strong>
                    <span className="muted">
                      {c.phone ?? c.email ?? "Sin datos de contacto"}
                      {c.status === "inactive" ? " · Inactivo" : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={
                      locked ||
                      saving ||
                      c.status !== "active" ||
                      value === c.id
                    }
                    onClick={() => onSelect(c.id)}
                    aria-label={"Seleccionar " + c.name}
                  >
                    {value === c.id ? "Seleccionado" : "Seleccionar"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No encontramos clientes. Puedes seguir sin seleccionar uno.</p>
          )}
        </>
      ) : null}
    </section>
  );
}

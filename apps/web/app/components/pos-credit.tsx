"use client";
import { useEffect, useState } from "react";
import type { CustomerDto } from "@smartretail/contracts";
import { purchasingApi } from "./purchasing-client";
import { minorUnitsToDecimal } from "../../lib/money-input";
export default function PosCredit({
  tenant,
  customerId,
  onStatus,
}: {
  tenant: string;
  customerId?: string;
  onStatus: (id: string, enabled: boolean) => void;
}) {
  const [data, setData] = useState<{
      customer: CustomerDto;
      outstanding: string;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    Promise.all([
      purchasingApi<{ customer: CustomerDto }>(
        `/api/v1/customers/${customerId}`,
        tenant,
        { signal: controller.signal },
      ),
      purchasingApi<{ outstandingAmount: { minorUnits: string } }>(
        `/api/v1/customers/${customerId}/credit`,
        tenant,
        { signal: controller.signal },
      ),
    ])
      .then(([c, s]) => {
        if (!controller.signal.aborted) {
          setData({
            customer: c.customer,
            outstanding: s.outstandingAmount.minorUnits,
          });
          onStatus(
            customerId,
            c.customer.creditEnabled === true && c.customer.status === "active",
          );
          setError("");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          onStatus(customerId, false);
          setError(
            "No pudimos consultar el crédito; el servidor lo validará al confirmar.",
          );
        }
      });
    return () => controller.abort();
  }, [tenant, customerId, onStatus]);
  const mxn = (value: string) => "$" + minorUnitsToDecimal(value) + " MXN";
  if (!customerId)
    return <p className="muted">Público general no puede comprar a crédito.</p>;
  return (
    <section className="card">
      <h2>Crédito para esta venta</h2>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data || data.customer.id !== customerId ? (
        <p role="status">Consultando crédito…</p>
      ) : (
        <>
          <p>
            <strong>{data.customer.name}</strong> ·{" "}
            {data.customer.creditEnabled && data.customer.status === "active"
              ? "Habilitado"
              : "No habilitado para nuevas ventas"}
          </p>
          <p>
            Saldo usado: {mxn(data.outstanding)}. Límite:{" "}
            {data.customer.creditLimit
              ? mxn(data.customer.creditLimit.minorUnits)
              : "Sin límite configurado"}
            .
          </p>
          {data.customer.creditLimit && (
            <p>
              Disponible:{" "}
              {mxn(
                (BigInt(data.customer.creditLimit.minorUnits) >
                BigInt(data.outstanding)
                  ? BigInt(data.customer.creditLimit.minorUnits) -
                    BigInt(data.outstanding)
                  : 0n
                ).toString(),
              )}
              .
            </p>
          )}
          <p className="muted">
            El saldo se vuelve a validar al completar; crédito pendiente no
            entra a caja.
          </p>
        </>
      )}
    </section>
  );
}

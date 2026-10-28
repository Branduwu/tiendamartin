import "../../apps/web/instrumentation-client";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import PosPanel from "../../apps/web/app/pos/pos-panel";
import ReturnPanel from "../../apps/web/app/sales/[id]/return-panel";
import ReceivablesPanel from "../../apps/web/app/receivables/receivables-panel";
import SupportPanel from "../../apps/web/app/help/support/support-panel";
import LocationSelector from "../../apps/web/app/components/location-selector";
import type {
  StoredSaleDto,
  InventoryLocationDto,
} from "@smartretail/contracts";
import "../../apps/web/app/globals.css";
import "../../apps/web/app/components/visual-system.css";

const host = window as typeof window & {
  React: typeof React;
  fixtureData: {
    recorded: StoredSaleDto;
    locations: InventoryLocationDto[];
    tenant: string;
    actor: string;
  };
  operationalMock: (
    url: string,
    init: { method: string; body?: string; headers: Record<string, string> },
  ) => Promise<{ status: number; body: unknown }>;
};
host.React = React;
window.fetch = (async (input, init) => {
  const response = await host.operationalMock(String(input), {
    method: init?.method ?? "GET",
    ...(typeof init?.body === "string" ? { body: init.body } : {}),
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
  });
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return new Response(JSON.stringify(response.body), {
    status: response.status,
  });
}) as typeof fetch;
function Selector() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <h1>Sucursales de prueba</h1>
      <LocationSelector
        locations={host.fixtureData.locations}
        selected={selected}
        onChange={setSelected}
      />
    </>
  );
}
function Fixture() {
  const { recorded, actor } = host.fixtureData;
  switch (location.pathname) {
    case "/pos":
      return <PosPanel userId={actor} />;
    case "/sales/ticket":
      return (
        <>
          <h1>Ticket de prueba</h1>
          <ReturnPanel
            recorded={recorded}
            initial={[]}
            initialSettlement={{
              outstandingAmount: { currency: "MXN", minorUnits: "3000" },
              payments: recorded.payments,
            }}
            userId={actor}
            canReturn={true}
            timezone="America/Mexico_City"
            locale="es-MX"
          />
        </>
      );
    case "/receivables":
      return <ReceivablesPanel userId={actor} />;
    case "/help/support":
      return <SupportPanel />;
    default:
      return <Selector />;
  }
}
createRoot(document.getElementById("root")!).render(
  ["/pos", "/receivables"].includes(location.pathname) ? (
    <Fixture />
  ) : (
    <main id="workspace-content">
      <Fixture />
    </main>
  ),
);

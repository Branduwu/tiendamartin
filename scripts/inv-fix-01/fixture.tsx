import React from "react";
import { createRoot } from "react-dom/client";
import InventoryPanel from "../../apps/web/app/inventory/inventory-panel";
const testWindow = window as unknown as Record<string, any>;
testWindow.React = React;
window.fetch = (async (input, init) => {
  const reply = await testWindow.inventoryMock(String(input), {
    method: init?.method ?? "GET",
    body: init?.body,
    headers: init?.headers,
  });
  return new Response(JSON.stringify(reply.body), { status: reply.status });
}) as typeof fetch;
const root = createRoot(document.getElementById("root")!);
const Panel = InventoryPanel as React.ComponentType<{ userId: string }>;
testWindow.mountInventory = (userId = "550e8400-e29b-41d4-a716-446655440020") =>
  root.render(<Panel key={userId} userId={userId} />);
testWindow.mountInventory();

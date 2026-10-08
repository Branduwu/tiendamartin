import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultBusinessProfile } from "@smartretail/application";
import TicketIdentity from "../app/components/ticket-identity";
import { reportPeriod } from "@smartretail/application";
it("renders business and branch identity as safe text without software branding", () => {
  const html = renderToStaticMarkup(
    createElement(TicketIdentity, {
      profile: {
        ...defaultBusinessProfile,
        businessName: "Legal",
        tradeName: "<script>Shop</script>",
        phone: "555",
      },
      branch: {
        name: "Original",
        displayName: "Central",
        phone: null,
        address: "Calle 1",
        receiptHeader: "Bienvenido",
      },
    }),
  );
  expect(html).toContain("&lt;script&gt;Shop&lt;/script&gt;");
  expect(html).toContain("Central");
  expect(html).toContain("Calle 1");
  expect(html).toContain("555");
  expect(html).not.toContain("SmartRetail");
});
it("uses legal business name when trade name and branch contacts are absent", () => {
  const html = renderToStaticMarkup(
    createElement(TicketIdentity, {
      profile: { ...defaultBusinessProfile, businessName: "Mi tienda" },
    }),
  );
  expect(html).toContain("Mi tienda");
  expect(html).not.toContain("undefined");
});
it("resolves report calendar boundaries in configured timezone", () => {
  const now = new Date("2026-10-08T06:30:00Z");
  expect(reportPeriod("today", now, "America/Tijuana").from).toBe("2026-10-07");
  expect(reportPeriod("today", now, "America/Mexico_City").from).toBe(
    "2026-10-08",
  );
});

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { appOrigin } from "../lib/app-origin";
import Script from "next/script";
import { THEME_BOOTSTRAP } from "../lib/theme";
import { PublicThemeControl } from "./components/theme-toggle";

export const metadata: Metadata = {
  metadataBase: appOrigin() ?? null,
  title: "SmartRetail",
  description: "Sistema de inventario y punto de venta.",
  icons: { icon: "data:," },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <Script id="smartretail-theme" strategy="beforeInteractive">
          {THEME_BOOTSTRAP}
        </Script>
      </head>
      <body>
        <PublicThemeControl />
        {children}
      </body>
    </html>
  );
}

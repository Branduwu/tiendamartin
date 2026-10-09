import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { appOrigin } from "../lib/app-origin";

export const metadata: Metadata = {
  metadataBase: appOrigin() ?? null,
  title: "SmartRetail",
  description: "Sistema de inventario y punto de venta.",
  icons: { icon: "data:," },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

import React from "react";
export default function Link({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
export const useRouter = () => router;
const router = {
  push: (url: string) =>
    window.dispatchEvent(new CustomEvent("test-route", { detail: url })),
  replace: (url: string) =>
    window.dispatchEvent(new CustomEvent("test-route", { detail: url })),
};
export const companyLabel = () => "Empresa ficticia";
export function Navigation() {
  return <nav aria-label="Navegación">Compras</nav>;
}
export function PurchasePayable() {
  return <p>Cuenta por pagar (simulada)</p>;
}
export function PurchaseDocument() {
  return <p>Documento (simulado)</p>;
}

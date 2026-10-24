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
export const companyLabel = (id: string) =>
  id.endsWith("1") ? "Empresa uno" : "Empresa dos";
export function Navigation() {
  return <nav aria-label="Navegación">Dashboard</nav>;
}
export function InitialSetup() {
  return null;
}

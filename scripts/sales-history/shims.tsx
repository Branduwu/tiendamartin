import React from "react";
export const companyLabel = () => "Empresa de prueba";
export default function Stub({
  children,
  href,
  className,
}: {
  children?: React.ReactNode;
  href?: string;
  className?: string;
}) {
  return href ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <nav aria-label="Navegación">Ventas</nav>
  );
}

import Link from "next/link";
const pages = [
  ["/dashboard", "Dashboard"],
  ["/products", "Productos"],
  ["/inventory", "Inventario"],
  ["/pos", "Punto de venta"],
  ["/cash", "Caja"],
  ["/sales", "Ventas"],
  ["/suppliers", "Proveedores"],
  ["/purchases", "Compras"],
  ["/customers", "Clientes"],
] as const;
export default function AppNavigation({
  current,
  blocked = false,
}: {
  current: string;
  blocked?: boolean;
}) {
  return (
    <nav className="app-nav" aria-label="Principal">
      {pages.map(([href, label]) =>
        blocked &&
        [
          "/products",
          "/inventory",
          "/pos",
          "/suppliers",
          "/purchases",
          "/customers",
          "/dashboard",
        ].includes(href) ? (
          <span
            key={href}
            aria-disabled="true"
            aria-current={current === href ? "page" : undefined}
          >
            {label}
          </span>
        ) : (
          <Link
            key={href}
            href={href}
            aria-current={current === href ? "page" : undefined}
          >
            {label}
          </Link>
        ),
      )}
    </nav>
  );
}
export function companyLabel(id: string, index: number) {
  return `Empresa ${index + 1} (${id.slice(-6)})`;
}

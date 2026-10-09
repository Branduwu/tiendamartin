/** Presentation only. Every API continues to authorize on the server. */
export type NavigationMembership = {
  tenantId: string;
  tenantName?: string;
  tenantStatus?: string;
  role?: string;
  displayName?: string | null;
  permissions: readonly string[];
};
type Destination = { href: string; label: string; permission: string };
type NavigationGroup = { id: string; label: string; items: Destination[] };
const groups: NavigationGroup[] = [
  {
    id: "home",
    label: "Inicio",
    items: [
      {
        href: "/dashboard",
        label: "Inicio y reportes",
        permission: "reports.read",
      },
    ],
  },
  {
    id: "sell",
    label: "Vender",
    items: [
      { href: "/pos", label: "Punto de venta", permission: "sales.create" },
      { href: "/cash", label: "Caja y turnos", permission: "cash.read" },
      { href: "/sales", label: "Ventas y tickets", permission: "sales.read" },
    ],
  },
  {
    id: "inventory",
    label: "Inventario",
    items: [
      { href: "/products", label: "Productos", permission: "products.read" },
      {
        href: "/inventory",
        label: "Existencias",
        permission: "inventory.read",
      },
      {
        href: "/inventory/alerts",
        label: "Alertas",
        permission: "inventory.read",
      },
      { href: "/labels", label: "Etiquetas", permission: "products.read" },
    ],
  },
  {
    id: "buy",
    label: "Comprar",
    items: [
      { href: "/purchases", label: "Compras", permission: "purchases.read" },
      {
        href: "/suppliers",
        label: "Proveedores",
        permission: "suppliers.read",
      },
      {
        href: "/payables",
        label: "Cuentas por pagar",
        permission: "payables.read",
      },
    ],
  },
  {
    id: "customers",
    label: "Clientes",
    items: [
      { href: "/customers", label: "Clientes", permission: "customers.read" },
      {
        href: "/receivables",
        label: "Cuentas por cobrar",
        permission: "receivables.read",
      },
    ],
  },
  {
    id: "finance",
    label: "Finanzas",
    items: [
      { href: "/expenses", label: "Gastos", permission: "expenses.read" },
    ],
  },
  {
    id: "settings",
    label: "Configuración",
    items: [
      {
        href: "/settings/business",
        label: "Negocio y sucursales",
        permission: "settings.manage",
      },
      {
        href: "/settings/users",
        label: "Equipo",
        permission: "members.manage",
      },
      {
        href: "/promotions",
        label: "Promociones",
        permission: "promotions.read",
      },
      {
        href: "/settings/taxes",
        label: "Impuestos",
        permission: "taxes.manage",
      },
    ],
  },
];
export function navigationGroups(
  permissions: readonly string[],
  role?: string,
) {
  const visible = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => permissions.includes(i.permission)),
    }))
    .filter((g) => g.items.length);
  const priority =
    role === "cashier"
      ? ["sell", "customers", "inventory", "finance"]
      : role === "inventory_clerk"
        ? ["inventory", "buy"]
        : [];
  return visible.sort(
    (a, b) =>
      (priority.indexOf(a.id) < 0 ? 99 : priority.indexOf(a.id)) -
      (priority.indexOf(b.id) < 0 ? 99 : priority.indexOf(b.id)),
  );
}
export function roleLabel(role?: string) {
  return (
    (
      {
        owner: "Propietario",
        admin: "Administrador",
        cashier: "Cajero",
        inventory_clerk: "Almacén",
      } as Record<string, string>
    )[role ?? ""] ?? "Usuario"
  );
}
export function roleLanding(member?: NavigationMembership): string {
  if (!member || member.tenantStatus === "suspended") return "/onboarding";
  const p = member.permissions;
  if (member.role === "cashier" && p.includes("sales.create")) return "/pos";
  if (member.role === "inventory_clerk" && p.includes("inventory.read"))
    return "/inventory";
  if (p.includes("reports.read")) return "/dashboard";
  if (p.includes("sales.create")) return "/pos";
  if (p.includes("inventory.read")) return "/inventory";
  if (p.includes("products.read")) return "/products";
  return "/onboarding";
}
/** Never mix permissions or identity from another company. */
export function navigationMember(
  members: readonly NavigationMembership[],
  tenantId: string,
) {
  return members.find((m) => m.tenantId === tenantId);
}
export function canOpenDashboard(members: readonly NavigationMembership[]) {
  return members.some(
    (m) =>
      m.tenantStatus !== "suspended" && m.permissions.includes("reports.read"),
  );
}

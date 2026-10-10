export const helpCategories = [
  "Primeros pasos",
  "Vender",
  "Inventario",
  "Comprar",
  "Clientes",
  "Administración",
  "Cuenta y acceso",
  "Soporte",
] as const;
export type HelpArticle = Readonly<{
  slug: string;
  title: string;
  category: (typeof helpCategories)[number];
  summary: string;
  keywords: string;
  steps: readonly string[];
  needs?: string;
  problems: readonly string[];
  related: readonly string[];
  action?: { href: string; label: string; permission: string };
}>;
const article = (
  slug: string,
  title: string,
  category: HelpArticle["category"],
  summary: string,
  steps: string[],
  problems: string[],
  related: string[],
  action?: HelpArticle["action"],
  needs?: string,
): HelpArticle => ({
  slug,
  title,
  category,
  summary,
  keywords: `${title} ${related.join(" ")}`,
  steps,
  problems,
  related,
  ...(action ? { action } : {}),
  ...(needs ? { needs } : {}),
});
export const helpArticles: readonly HelpArticle[] = [
  article(
    "camera",
    "Permitir cámara y leer desde una foto",
    "Vender",
    "El permiso se solicita sólo al iniciar Escanear con cámara. Se prefiere la cámara trasera; cerrar o salir detiene la cámara.",
    [
      "Abre Escanear e inicia la cámara.",
      "Permite el acceso del navegador y apunta al código con buena luz.",
      "También puedes subir JPEG, PNG o WebP de hasta 8 MB desde tu teléfono.",
      "Confirma la lectura o escribe el código manualmente.",
    ],
    [
      "Si la cámara está ocupada, cierra otra aplicación y reintenta.",
      "Si denegaste permiso, revísalo en los ajustes del navegador; manual siempre está disponible.",
      "Compatibilidad depende del navegador y dispositivo; no es soporte universal.",
    ],
    ["scan", "qr"],
  ),
  article(
    "qr",
    "Leer QR de forma segura",
    "Vender",
    "Un QR puede contener un código, texto o un enlace. SmartRetail lo trata como datos: no abre URLs ni ejecuta instrucciones.",
    [
      "Lee el QR con cámara o fotografía.",
      "Revisa el resultado y confirma sólo si es un código de producto.",
      "Para contenido desconocido, usa búsqueda manual.",
    ],
    [
      "Un enlace externo no identifica automáticamente un producto.",
      "Nunca escribas contraseñas o tokens en un QR de prueba.",
    ],
    ["scan", "camera"],
  ),
  article(
    "product-photo",
    "Foto principal del producto",
    "Inventario",
    "La foto es opcional. Puedes tomarla o elegirla, revisar una vista previa y aplicarla al guardar. Las fotos para escanear son distintas y no se almacenan.",
    [
      "Con permiso de editar, abre Crear o Editar producto.",
      "En Foto del producto toma o selecciona JPEG, PNG o WebP hasta 8 MB.",
      "Revisa la vista previa y guarda el producto.",
      "Para reemplazar o eliminar, edita de nuevo y confirma Guardar.",
    ],
    [
      "La imagen se reduce y recodifica sin conservar EXIF; no se guardan imágenes binarias en la base de datos.",
      "Si el producto se guardó pero la foto falló, reintenta conservando la vista previa.",
      "Si otra persona cambió la foto, recarga antes de reemplazarla.",
    ],
    ["products", "scan"],
    { href: "/products", label: "Ver productos", permission: "products.read" },
  ),
  article(
    "business",
    "Configurar tu empresa",
    "Primeros pasos",
    "El nombre comercial, las sucursales y el pie del ticket identifican tu negocio. SmartRetail es el software; tus tickets muestran tu identidad comercial.",
    [
      "Abre Configuración del negocio.",
      "Revisa nombre, zona horaria y datos de contacto.",
      "Guarda y revisa un ticket.",
    ],
    [
      "Sólo Propietario y Administrador pueden editar la configuración.",
      "El logo está pendiente de una integración de almacenamiento; no se carga desde aquí.",
    ],
    ["branches", "taxes"],
    {
      href: "/settings/business",
      label: "Configurar negocio",
      permission: "settings.manage",
    },
  ),
  article(
    "branches",
    "Sucursales y ubicaciones",
    "Primeros pasos",
    "Cada ubicación conserva sus existencias y operaciones. Una sucursal inactiva mantiene el historial, pero no admite nuevas ventas, cajas o recepciones.",
    [
      "Revisa las sucursales en Configuración del negocio.",
      "Asigna las ubicaciones necesarias al equipo.",
      "Antes de operar, confirma la sucursal visible.",
    ],
    [
      "Cajero y Almacén sólo operan en sus ubicaciones asignadas.",
      "Solicita al administrador activar una sucursal que necesites.",
    ],
    ["users", "cash"],
    {
      href: "/settings/business",
      label: "Ver sucursales",
      permission: "settings.manage",
    },
  ),
  article(
    "products",
    "Crear tu primer producto",
    "Primeros pasos",
    "El producto reúne nombre, SKU, unidad, precio de venta y código de barras opcional. Crear un producto no agrega existencias.",
    [
      "En Productos, elige Agregar producto.",
      "Completa nombre, SKU, unidad y precio.",
      "Guarda; registra después el inventario inicial.",
    ],
    [
      "Sólo Propietario y Administrador pueden crear o editar productos.",
      "Un código de barras faltante no se inventa automáticamente.",
    ],
    ["inventory", "labels"],
    { href: "/products", label: "Ver productos", permission: "products.read" },
  ),
  article(
    "inventory",
    "Registrar inventario y movimientos",
    "Inventario",
    "Las existencias cambian mediante entradas, salidas, conteos o transferencias. El historial permite conocer qué ocurrió; no se borra para corregir un saldo.",
    [
      "Selecciona producto y ubicación.",
      "Para inventario inicial, registra una entrada con cantidad y motivo.",
      "Confirma el saldo del servidor.",
      "Para mover entre sucursales, usa Transferir.",
    ],
    [
      "Almacén puede recibir, retirar y transferir; el ajuste por conteo requiere un administrador.",
      "Si la respuesta es incierta, reintenta la misma operación; no crees otra entrada.",
      "Una salida no puede dejar existencias negativas.",
    ],
    ["minimum-stock", "purchase-reception"],
    {
      href: "/inventory",
      label: "Ver inventario",
      permission: "inventory.read",
    },
  ),
  article(
    "minimum-stock",
    "Stock mínimo y alertas",
    "Inventario",
    "Cuando la existencia llega al mínimo o queda por debajo, aparece una alerta. Cero existencias se muestra como agotado. La sugerencia de compra no crea ni recibe mercancía automáticamente.",
    [
      "Revisa las alertas por sucursal.",
      "Un administrador configura el mínimo del producto.",
      "Usa la sugerencia para preparar una compra.",
    ],
    [
      "Imprimir etiquetas no cambia existencias.",
      "Almacén y Cajero pueden consultar alertas, pero no cambiar mínimos.",
    ],
    ["inventory", "purchase-orders"],
    {
      href: "/inventory/alerts",
      label: "Ver alertas",
      permission: "inventory.read",
    },
  ),
  article(
    "labels",
    "Imprimir etiquetas",
    "Inventario",
    "Las etiquetas muestran nombre, SKU, precio actual y el código de barras guardado. No son un movimiento de inventario.",
    [
      "Desde Productos elige Imprimir etiqueta.",
      "Selecciona cantidad y tamaño.",
      "Revisa la vista previa e imprime.",
    ],
    [
      "Sin código de barras, la etiqueta lo indica; no se generan barras vacías.",
      "La impresión del navegador puede necesitar ajustar escala y márgenes.",
    ],
    ["products", "scan"],
    {
      href: "/labels",
      label: "Preparar etiquetas",
      permission: "products.read",
    },
  ),
  article(
    "cash",
    "Abrir y operar caja",
    "Vender",
    "El turno registra quién abre y cierra, el efectivo inicial y los movimientos. Necesitas una caja abierta en la sucursal para completar una venta.",
    [
      "En Caja y turnos, selecciona una sucursal autorizada.",
      "Registra el efectivo inicial y abre el turno.",
      "Registra las entradas o salidas de efectivo con su motivo.",
      "Al terminar cuenta el efectivo y cierra.",
    ],
    [
      "No puedes abrir caja en una ubicación ajena o inactiva.",
      "Una caja cerrada conserva su historial.",
    ],
    ["expected-cash", "cash-difference", "checkout"],
    { href: "/cash", label: "Abrir caja", permission: "cash.open" },
  ),
  article(
    "expected-cash",
    "Dinero esperado en caja",
    "Vender",
    "Es el efectivo inicial más ventas y entradas en efectivo, menos salidas de efectivo, incluidos reembolsos y gastos. Los pagos con tarjeta y la deuda a crédito no son billetes en caja; los cobros de crédito en efectivo sí registran una entrada.",
    [
      "Revisa el resumen del turno.",
      "Confirma que los movimientos de efectivo estén registrados.",
      "Cuenta físicamente el efectivo antes de cerrar.",
    ],
    [
      "No compares el total de ventas con los billetes: puede incluir tarjetas o crédito.",
      "Un reembolso o gasto en efectivo reduce lo esperado.",
    ],
    ["cash", "cash-difference"],
  ),
  article(
    "cash-difference",
    "Faltantes y sobrantes",
    "Vender",
    "La diferencia es efectivo contado menos esperado. Negativa significa faltante; positiva significa sobrante. El cierre no modifica automáticamente movimientos históricos.",
    [
      "Cuenta el efectivo real.",
      "Revisa ventas y movimientos del turno.",
      "Registra el cierre con el conteo correcto.",
    ],
    [
      "No agregues una venta ficticia para cuadrar caja.",
      "Reporta una diferencia que no puedas explicar al administrador.",
    ],
    ["cash", "expected-cash"],
  ),
  article(
    "pos",
    "Tu primera venta en el punto de venta",
    "Primeros pasos",
    "El POS reúne productos, cliente opcional, descuentos permitidos y cobro. Revisa la sucursal y el cajero antes de confirmar.",
    [
      "Abre caja en tu sucursal.",
      "Busca o escanea productos y revisa cantidades.",
      "Selecciona cliente si hace falta; Público general también es válido.",
      "Revisa subtotal, descuentos, impuestos y total.",
      "Completa el cobro.",
    ],
    [
      "Sin caja abierta no puedes completar la venta.",
      "La confirmación valida existencias y configuración actual en el servidor.",
    ],
    ["scan", "checkout", "suspend"],
    { href: "/pos", label: "Ir al punto de venta", permission: "sales.create" },
  ),
  article(
    "scan",
    "Escanear un código de barras",
    "Vender",
    "Puedes leer códigos con un lector físico, cámara, foto o entrada manual. La cámara y las fotos de lectura se procesan en tu dispositivo; no se guardan. Confirma la lectura antes de buscar.",
    [
      "En POS selecciona una sucursal y toca Escanear, o enfoca Código de barras para usar el lector físico.",
      "Inicia la cámara y coloca el código dentro del recuadro; confirma Usar este código.",
      "Una pieza se agrega una sola vez; para unidades por peso indica la cantidad.",
      "En Productos puedes escanear para buscar o llenar el barcode al crear/editar sin guardar automáticamente.",
    ],
    [
      "Si no se encuentra, revisa el código o busca por nombre. Sólo quien puede editar productos recibe Crear producto.",
      "Si rechazas cámara, usa foto o código manual.",
      "No abras enlaces de QR: SmartRetail los muestra como texto, nunca navega automáticamente.",
    ],
    ["camera", "qr", "product-photo", "checkout"],
    { href: "/pos", label: "Abrir POS", permission: "sales.create" },
  ),
  article(
    "checkout",
    "Cobrar y consultar el ticket",
    "Vender",
    "El cobro confirma venta, pagos y existencias juntos. Una respuesta incierta no significa que la venta haya fallado: conserva la misma solicitud para reintentar.",
    [
      "Revisa cliente, productos y total.",
      "Elige los métodos de pago y completa los importes.",
      "Confirma una vez y espera el resultado.",
      "Consulta la venta y su ticket en el historial.",
    ],
    [
      "Para crédito necesitas un cliente activo y habilitado; si tiene límite configurado, también saldo disponible.",
      "No crees otra venta si la primera quedó sin respuesta; reintenta la misma.",
    ],
    ["tickets", "credit", "taxes"],
    { href: "/pos", label: "Cobrar en POS", permission: "sales.create" },
  ),
  article(
    "tickets",
    "Ventas y tickets",
    "Vender",
    "El ticket muestra negocio, sucursal, cajero, cliente y el desglose de la venta. El historial conserva lo cobrado aunque cambien precios o impuestos después.",
    [
      "Abre Ventas y tickets.",
      "Selecciona una venta.",
      "Revisa o imprime el ticket.",
    ],
    [
      "El ticket básico no es un CFDI.",
      "Los datos históricos no se recalculan con la configuración actual.",
    ],
    ["returns", "taxes"],
    { href: "/sales", label: "Ver ventas", permission: "sales.read" },
  ),
  article(
    "suspend",
    "Suspender una venta",
    "Vender",
    "Suspender guarda un carrito para retomarlo. No reserva ni descuenta existencias; al reanudar se revisan precios actuales y debes volver a seleccionar el cliente.",
    [
      "En POS guarda la venta suspendida.",
      "Después elige la venta guardada.",
      "Revisa productos, cantidades, cliente y precios antes de cobrar.",
    ],
    [
      "Las existencias pueden haber cambiado mientras estuvo suspendida.",
      "Suspender no genera un ticket de venta cobrada.",
    ],
    ["pos", "checkout"],
    { href: "/pos", label: "Volver al POS", permission: "sales.create" },
  ),
  article(
    "returns",
    "Devolver productos y reembolsar",
    "Vender",
    "Las devoluciones parten de una venta histórica. Una devolución parcial usa el valor e impuesto originales y registra movimientos trazables.",
    [
      "Abre el detalle de la venta.",
      "Selecciona productos y cantidades a devolver.",
      "Revisa reembolso y método permitido.",
      "Confirma y consulta el resultado.",
    ],
    [
      "Cajero y Almacén no tienen permiso para devoluciones; solicita a un administrador.",
      "No se puede devolver más de lo vendido.",
      "El reembolso no usa el impuesto actual.",
    ],
    ["tickets", "cash"],
    { href: "/sales", label: "Consultar venta", permission: "sales.return" },
  ),
  article(
    "suppliers",
    "Registrar proveedores",
    "Comprar",
    "El proveedor identifica a quién compras. No necesitas datos fiscales adicionales para empezar.",
    [
      "En Proveedores busca antes de crear.",
      "Registra nombre y contacto necesario.",
      "Usa el proveedor al preparar una orden.",
    ],
    [
      "Almacén puede consultar proveedores, pero no administrarlos.",
      "Conserva el historial de proveedores con compras.",
    ],
    ["purchase-orders", "payables"],
    {
      href: "/suppliers",
      label: "Ver proveedores",
      permission: "suppliers.read",
    },
  ),
  article(
    "purchase-orders",
    "Preparar una orden de compra",
    "Comprar",
    "Una orden registra lo solicitado al proveedor. Las existencias sólo aumentan al recibir mercancía, no al crear la orden.",
    [
      "Selecciona proveedor y sucursal.",
      "Agrega productos, cantidades y costos.",
      "Confirma la orden.",
      "Registra la recepción cuando llegue mercancía.",
    ],
    [
      "Almacén puede consultar y recibir, pero no crear órdenes.",
      "Una sucursal inactiva no acepta nuevas compras.",
    ],
    ["purchase-reception", "payables"],
    { href: "/purchases", label: "Ver compras", permission: "purchases.read" },
  ),
  article(
    "purchase-reception",
    "Recepción parcial o completa",
    "Comprar",
    "No tienes que recibir toda la orden de una vez. Cada recepción registra sólo lo que llegó y conserva lo pendiente.",
    [
      "Abre la orden confirmada.",
      "Indica lo recibido por producto.",
      "Confirma y verifica existencias.",
      "Repite cuando llegue el resto.",
    ],
    [
      "No puedes recibir más de lo pendiente.",
      "Reintenta la misma recepción si no pudiste confirmar el resultado.",
    ],
    ["purchase-orders", "inventory"],
    {
      href: "/purchases",
      label: "Consultar órdenes",
      permission: "purchases.read",
    },
  ),
  article(
    "payables",
    "Gastos y cuentas por pagar",
    "Comprar",
    "Las cuentas por pagar muestran compromisos con proveedores; los gastos registran salidas operativas. Un pago en efectivo vinculado a caja debe conservar su movimiento.",
    [
      "Revisa la cuenta y su saldo pendiente.",
      "Registra el importe y método de pago; el sistema registra la fecha.",
      "Confirma el nuevo saldo y el historial.",
    ],
    [
      "Cajero puede consultar gastos, pero no administrar cuentas por pagar.",
      "No borres movimientos para corregir un pago contabilizado.",
    ],
    ["purchase-orders", "cash"],
    {
      href: "/payables",
      label: "Ver cuentas por pagar",
      permission: "payables.read",
    },
  ),
  article(
    "customers",
    "Clientes e historial",
    "Clientes",
    "Asociar un cliente a una venta es opcional. El historial reúne compras y devoluciones; desactivar al cliente no elimina ventas anteriores.",
    [
      "Busca por nombre, teléfono o correo.",
      "Crea al cliente sólo si no existe.",
      "Selecciónalo en POS o usa Público general.",
      "Consulta su historial desde Clientes.",
    ],
    [
      "Un cliente inactivo no puede asociarse a una venta nueva.",
      "Registra sólo los datos de contacto que necesites.",
    ],
    ["credit", "checkout"],
    { href: "/customers", label: "Ver clientes", permission: "customers.read" },
  ),
  article(
    "credit",
    "Límite de crédito y cuentas por cobrar",
    "Clientes",
    "El límite controla cuánto puede adeudar un cliente habilitado. Si configuraste un límite, el saldo pendiente debe caber en él al confirmar; no es un descuento ni un pago en efectivo.",
    [
      "Un administrador habilita crédito y, si corresponde, configura un límite.",
      "En POS selecciona al cliente y revisa crédito disponible.",
      "Registra los cobros en Cuentas por cobrar.",
      "Consulta pagos y saldo pendiente.",
    ],
    [
      "Cajero puede vender a crédito permitido y cobrar, pero no configurar límites.",
      "Sin cliente activo y habilitado, el cobro a crédito se rechaza.",
    ],
    ["customers", "cash", "checkout"],
    {
      href: "/receivables",
      label: "Ver cuentas por cobrar",
      permission: "receivables.read",
    },
  ),
  article(
    "users",
    "Invitar y administrar equipo",
    "Administración",
    "Cada miembro tiene un rol y, cuando corresponde, sucursales asignadas. Desactivarlo bloquea su operación nueva y conserva la atribución histórica.",
    [
      "Abre Usuarios en Configuración.",
      "Invita al correo correcto o administra un miembro existente.",
      "Elige rol y sucursales autorizadas.",
      "Pide al invitado iniciar sesión con el mismo correo y aceptar.",
    ],
    [
      "Una invitación usada no vuelve a aceptarse.",
      "Administrador no puede convertirse en Propietario ni administrar plataforma.",
      "No cambies tu propio rol desde esta pantalla.",
    ],
    ["roles", "branches", "account"],
    {
      href: "/settings/users",
      label: "Administrar usuarios",
      permission: "members.manage",
    },
  ),
  article(
    "promotions",
    "Descuentos, promociones y cupones",
    "Administración",
    "Los descuentos de línea y promociones se aplican antes del impuesto. El cupón de venta se distribuye en las líneas antes de calcular su impuesto; el checkout conserva el desglose confirmado.",
    [
      "Un administrador configura promociones o cupones.",
      "En POS revisa el descuento permitido.",
      "Confirma el total con sus impuestos.",
    ],
    [
      "Cajero tiene un límite de 20% para descuento manual.",
      "Una promoción desactivada o vencida no se aplica al confirmar.",
    ],
    ["taxes", "checkout"],
    {
      href: "/promotions",
      label: "Ver promociones",
      permission: "promotions.read",
    },
  ),
  article(
    "taxes",
    "Configurar impuestos sin CFDI",
    "Administración",
    "El negocio define tasas por perfil y puede asociarlas a productos. Sin perfil no hay impuesto configurado. Esta función calcula impuestos y no genera CFDI ni timbrado.",
    [
      "Crea un perfil con la tasa que necesita tu negocio.",
      "Asócialo al producto.",
      "En POS revisa base después de descuentos, impuesto y total.",
      "Consulta el desglose en el ticket.",
    ],
    [
      "No se asigna IVA 16% automáticamente.",
      "Cambiar una tasa no cambia ventas ni devoluciones históricas.",
      "El servidor usa la configuración válida al confirmar.",
    ],
    ["promotions", "tickets", "returns"],
    {
      href: "/settings/taxes",
      label: "Configurar impuestos",
      permission: "taxes.manage",
    },
  ),
  article(
    "account",
    "Acceso, contraseña e invitaciones",
    "Cuenta y acceso",
    "Tu cuenta te identifica; las membresías determinan a qué empresas y sucursales accedes. La invitación debe aceptarse con el correo al que fue enviada.",
    [
      "Inicia sesión con tu correo y contraseña.",
      "Si la olvidaste, usa Recuperar contraseña en login.",
      "Abre el correo de recuperación y define la nueva contraseña.",
      "Para cambiarla con sesión abierta, usa Cuenta → Cambiar contraseña.",
    ],
    [
      "Si un enlace expiró, solicita uno nuevo.",
      "No compartas contraseñas, códigos ni enlaces privados de invitación.",
      "Una empresa suspendida no permite operar: contacta a su administrador.",
    ],
    ["users", "support"],
  ),
  article(
    "support",
    "Pedir ayuda a SmartRetail",
    "Soporte",
    "Puedes enviar una solicitud dentro de SmartRetail y consultar su estado. Cada usuario ve sólo sus propias solicitudes en la empresa elegida; no es un chat ni recepción de correo.",
    [
      "Abre Ayuda y soporte.",
      "Elige empresa, categoría y un asunto concreto.",
      "Describe qué intentabas hacer sin incluir datos privados.",
      "Envía y conserva el folio; consulta Mis solicitudes.",
    ],
    [
      "No incluyas contraseñas, tokens, datos de pago ni enlaces de invitación.",
      "No se adjuntan logs, cookies, almacenamiento del navegador ni otros formularios.",
      "Puedes enviar hasta 20 solicitudes por hora; los reintentos de la misma no se duplican.",
    ],
    ["account"],
  ),
];
export const roleGuides = {
  owner: {
    title: "Propietario",
    summary:
      "Administra su empresa, operación, equipo, sucursales y configuración. No es Administrador de SmartRetail.",
  },
  admin: {
    title: "Administrador",
    summary:
      "Administra la operación y configuración de la empresa. No puede convertirse en Propietario, cambiar a un Propietario ni obtener acceso a plataforma.",
  },
  cashier: {
    title: "Cajero",
    summary:
      "Diseñado para vender y operar caja sin acceso innecesario a la administración. Trabaja en sucursales asignadas: POS, ventas, tickets, clientes y cobros de crédito. Consulta productos, etiquetas, inventario y gastos. Descuento manual hasta 20%. No edita productos, hace devoluciones, ajusta inventario, configura crédito ni administra compras, reportes o equipo.",
  },
  inventory_clerk: {
    title: "Almacén",
    summary:
      "Consulta productos, alertas, etiquetas, proveedores y compras en sucursales asignadas. Registra entradas, salidas, transferencias y recepciones de compra. No hace ajustes por conteo, configura mínimos, crea órdenes, edita productos ni opera POS, caja o administración.",
  },
} as const;
export function searchHelp(query: string, permissions: readonly string[] = []) {
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
  return helpArticles
    .filter((a) =>
      words.every((w) =>
        normalize(`${a.title} ${a.keywords} ${a.summary}`).includes(w),
      ),
    )
    .sort(
      (a, b) =>
        Number(!!b.action && permissions.includes(b.action.permission)) -
        Number(!!a.action && permissions.includes(a.action.permission)),
    );
}

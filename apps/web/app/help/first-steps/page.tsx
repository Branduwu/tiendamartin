import InitialSetupPanel from "../initial-setup";
import Link from "next/link";
export default function FirstStepsPage() {
  return (
    <>
      <h1>Configuración inicial</h1>
      <p>
        El progreso se obtiene de los datos de tu empresa. Impuestos y equipo
        son opcionales según tu operación.
      </p>
      <p className="muted">
        Equipo se completa cuando otro miembro está activo. Caja, inventario y
        primera venta se reconocen por su historial, aunque el turno ya esté
        cerrado.
      </p>
      <InitialSetupPanel />
      <Link href="/help">Volver a Ayuda</Link>
    </>
  );
}

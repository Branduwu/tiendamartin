export default function NotFound() {
  return (
    <main className="workspace">
      <section className="card">
        <h1>No encontramos esta página</h1>
        <p>La dirección no existe o ya no está disponible.</p>
        <nav aria-label="Recuperar navegación">
          <a href="/onboarding">Volver a mis empresas</a>
          {" · "}
          <a href="/login">Ir al inicio de sesión</a>
        </nav>
      </section>
    </main>
  );
}

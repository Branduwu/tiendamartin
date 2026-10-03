"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="workspace">
      <section className="card">
        <h1>No pudimos cargar esta pantalla</h1>
        <p role="alert" className="error">
          Inténtalo de nuevo. Si el problema continúa, consulta al
          administrador.
        </p>
        <div className="actions">
          <button onClick={reset}>Reintentar</button>
          <Link href="/products">Volver a productos</Link>
        </div>
      </section>
    </main>
  );
}

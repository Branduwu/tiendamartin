import Head from "next/head";

// Separate, prerendered server fallback. App Router's interactive error
// boundaries remain unchanged and keep their nonce policy and retry handlers.
export default function StaticServerError() {
  return (
    <>
      <Head>
        <title>No pudimos cargar la página · SmartRetail</title>
        <meta
          httpEquiv="Content-Security-Policy"
          content="script-src 'none'; script-src-attr 'none'"
        />
        <meta name="robots" content="noindex" />
      </Head>
      <main>
        <h1>No pudimos cargar la página</h1>
        <p>
          Ocurrió un error del servidor. Puedes volver a intentar desde el
          inicio.
        </p>
        <nav aria-label="Recuperar navegación">
          <a href="/onboarding">Volver a mis empresas</a>
          {" · "}
          <a href="/login">Ir al inicio de sesión</a>
        </nav>
      </main>
    </>
  );
}

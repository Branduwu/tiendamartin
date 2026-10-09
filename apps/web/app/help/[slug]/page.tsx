import { notFound } from "next/navigation";
import Link from "next/link";
import { helpArticles } from "../../../lib/help-content";
import HelpAction from "../help-action";
export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = (await params).slug;
  const article = helpArticles.find((x) => x.slug === slug);
  if (!article) notFound();
  return (
    <article className="help-article">
      <Link href="/help">← Todas las guías</Link>
      <p className="eyebrow">{article.category}</p>
      <h1>{article.title}</h1>
      <h2>Qué es</h2>
      <p>{article.summary}</p>
      {article.needs && (
        <>
          <h2>Qué necesitas</h2>
          <p>{article.needs}</p>
        </>
      )}
      {article.action && (
        <p>
          Para realizar esta acción necesitas el permiso correspondiente. Si no
          está disponible en tu rol, pide ayuda al administrador.
        </p>
      )}
      <h2>Cómo hacerlo</h2>
      <ol>
        {article.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {article.action && <HelpAction action={article.action} />}
      <h2>Problemas comunes</h2>
      <ul>
        {article.problems.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <h2>Relacionado</h2>
      <ul>
        {article.related.map((slug) => {
          const related = helpArticles.find((x) => x.slug === slug);
          return related ? (
            <li key={slug}>
              <Link href={`/help/${slug}`}>{related.title}</Link>
            </li>
          ) : slug === "roles" ? (
            <li key={slug}>
              <Link href="/help/roles">Guía de roles</Link>
            </li>
          ) : null;
        })}
      </ul>
      <Link href="/help/support">
        ¿Aún necesitas ayuda? Contactar SmartRetail
      </Link>
    </article>
  );
}

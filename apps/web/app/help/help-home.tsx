"use client";
import { useState } from "react";
import Link from "next/link";
import { helpCategories, searchHelp } from "../../lib/help-content";
import { usePurchasingCompany } from "../components/purchasing-client";
export default function HelpHome() {
  const [search, setSearch] = useState("");
  const { permissions } = usePurchasingCompany();
  const results = searchHelp(search, permissions);
  return (
    <>
      <div className="heading">
        <div>
          <h1>Ayuda</h1>
          <p>Encuentra cómo hacerlo, paso a paso.</p>
        </div>
        <Link href="/help/support">Ayuda y soporte</Link>
      </div>
      <label className="field">
        Buscar en la guía
        <input
          type="search"
          maxLength={120}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Por ejemplo: abrir caja o stock mínimo"
        />
      </label>
      <div className="help-shortcuts">
        <Link href="/help/first-steps">Ver configuración inicial</Link>
        <Link href="/help/roles">¿Qué puedo hacer según mi rol?</Link>
      </div>
      {search && <p role="status">{results.length} guías encontradas</p>}
      {!results.length && (
        <div className="empty-state">
          <h2>No encontramos esa guía</h2>
          <p>
            Prueba con caja, inventario o clientes. También puedes pedir
            soporte.
          </p>
          <Link href="/help/support">Contactar SmartRetail</Link>
        </div>
      )}
      <div className="help-categories">
        {helpCategories.map((category) => {
          const articles = results.filter((a) => a.category === category);
          return articles.length ? (
            <section key={category} className="panel stack">
              <h2>{category}</h2>
              <ul className="help-articles">
                {articles.map((a) => (
                  <li key={a.slug}>
                    <Link href={`/help/${a.slug}`}>{a.title}</Link>
                    <p>{a.summary}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null;
        })}
      </div>
    </>
  );
}

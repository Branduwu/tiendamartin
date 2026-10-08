"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { PlatformOverview } from "@smartretail/application";
import { CreateCompanySchema } from "@smartretail/contracts";
import {
  purchasingApi,
  PurchasingApiError,
} from "../../components/purchasing-client";
type Command = { id: string; displayName: string; ownerUserId: string };
function CreateCompany({
  actor,
  onSaved,
}: {
  actor: string;
  onSaved: () => void;
}) {
  const key = "smartretail.platform-company." + actor,
    [name, setName] = useState(""),
    [owner, setOwner] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [directory, setDirectory] = useState<{
      query: string;
      page: number;
      users: { id: string; email: string }[];
    }>(),
    [command, setCommand] = useState<Command | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [searchError, setSearchError] = useState("");
  const [directoryRevision, setDirectoryRevision] = useState(0);
  useEffect(() => {
    const recovery = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const p = CreateCompanySchema.safeParse(JSON.parse(raw));
          if (p.success) {
            setCommand(p.data);
            setName(p.data.displayName);
            setOwner(p.data.ownerUserId);
          } else sessionStorage.removeItem(key);
        }
      } catch {
        setError("No pudimos recuperar la solicitud anterior.");
      }
      setReady(true);
    }, 0);
    return () => clearTimeout(recovery);
  }, [key]);
  useEffect(() => {
    const c = new AbortController();
    const timer = setTimeout(() => {
      purchasingApi<{ users: { id: string; email: string }[] }>(
        "/api/v1/platform/auth-users?search=" +
          encodeURIComponent(search) +
          "&page=" +
          page,
        undefined,
        { signal: c.signal },
      )
        .then((d) => {
          if (!c.signal.aborted) {
            setDirectory({ query: search, page, users: d.users });
            setSearchError("");
          }
        })
        .catch((e) => {
          if (!c.signal.aborted)
            setSearchError(
              e instanceof Error ? e.message : "No pudimos buscar usuarios.",
            );
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [search, page, directoryRevision]);
  const users =
    directory?.query === search && directory.page === page
      ? directory.users
      : undefined;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    const body = command ?? {
      id: crypto.randomUUID(),
      displayName: name.trim(),
      ownerUserId: owner,
    };
    const parsed = CreateCompanySchema.safeParse(body);
    if (!parsed.success) {
      setError("Escribe el nombre y selecciona un usuario Auth existente.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      sessionStorage.setItem(key, JSON.stringify(parsed.data));
      setCommand(parsed.data);
      await purchasingApi("/api/v1/platform/companies", undefined, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      sessionStorage.removeItem(key);
      setCommand(null);
      setName("");
      setOwner("");
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos confirmar la creación.",
      );
      if (
        e instanceof PurchasingApiError &&
        [400, 403, 409].includes(e.status)
      ) {
        sessionStorage.removeItem(key);
        setCommand(null);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>Nueva empresa</h2>
      <p>
        Selecciona un usuario Auth existente como propietario. La cuenta de
        plataforma y el owner de empresa son permisos separados.
      </p>
      {error && <p role="alert">{error}</p>}
      <fieldset className="stack" disabled={busy || !ready || command !== null}>
        <label>
          Nombre de la empresa
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label>
          Buscar usuario Auth por email
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            maxLength={254}
          />
        </label>
        {searchError && (
          <p role="alert">
            {searchError}
            <button
              type="button"
              onClick={() => {
                setSearchError("");
                setDirectoryRevision((n) => n + 1);
              }}
            >
              Reintentar búsqueda
            </button>
          </p>
        )}
        <label>
          Propietario
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            required
          >
            <option value="">Selecciona un usuario</option>
            {owner && !users?.some((u) => u.id === owner) && (
              <option value={owner}>Usuario seleccionado</option>
            )}
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
        </label>
        {!users && !searchError && <p role="status">Buscando usuarios...</p>}
        <div className="actions">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Usuarios anteriores
          </button>
          <button
            type="button"
            disabled={!users || users.length < 50}
            onClick={() => setPage((p) => p + 1)}
          >
            Más usuarios
          </button>
        </div>
      </fieldset>
      {command && (
        <p role="status">
          Solicitud pendiente: reintenta los mismos datos para comprobar su
          resultado.
        </p>
      )}
      <button disabled={busy || !ready}>
        {busy
          ? "Creando..."
          : command
            ? "Reintentar creación"
            : "Crear empresa"}
      </button>
    </form>
  );
}
export default function CompanyList({ actor }: { actor: string }) {
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [loaded, setLoaded] = useState<{
      page: number;
      revision: number;
      value: PlatformOverview;
    }>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const c = new AbortController();
    purchasingApi<PlatformOverview>(
      "/api/v1/platform/companies?page=" + page,
      undefined,
      { signal: c.signal },
    )
      .then((value) => {
        if (!c.signal.aborted) {
          setLoaded({ page, revision, value });
          setError("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e instanceof Error ? e.message : "No pudimos consultar empresas.",
          );
      });
    return () => c.abort();
  }, [page, revision]);
  const data =
    loaded?.page === page && loaded.revision === revision
      ? loaded.value
      : undefined;
  return (
    <>
      <h1>Empresas</h1>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setRevision((n) => n + 1)}>
            Reintentar consulta
          </button>
        </p>
      )}
      <CreateCompany
        actor={actor}
        onSaved={() => {
          setNotice("Empresa creada con su propietario y perfil inicial.");
          setPage(1);
          setRevision((n) => n + 1);
        }}
      />
      {data ? (
        <>
          <section className="stack" aria-label="Empresas registradas">
            {data.companies.map((c) => (
              <article className="panel stack" key={c.id}>
                <h2>
                  <Link href={"/platform/companies/" + c.id}>
                    {c.displayName}
                  </Link>
                </h2>
                <p>
                  {c.status === "active" ? "Activa" : "Suspendida"} ·{" "}
                  {c.userCount} usuarios
                </p>
                <p>Propietario: {c.owner}</p>
                <p>
                  Alta en plataforma:{" "}
                  {new Date(c.createdAt).toLocaleDateString("es-MX", {
                    timeZone: "America/Mexico_City",
                  })}
                </p>
              </article>
            ))}
            {!data.companies.length && <p>No hay empresas en esta página.</p>}
          </section>
          <div className="actions">
            <button disabled={page === 1} onClick={() => setPage((n) => n - 1)}>
              Empresas anteriores
            </button>
            <span>Página {page}</span>
            <button
              disabled={page * 50 >= data.summary.total}
              onClick={() => setPage((n) => n + 1)}
            >
              Más empresas
            </button>
          </div>
        </>
      ) : !error ? (
        <p role="status">Cargando empresas...</p>
      ) : null}
    </>
  );
}

"use client";
import { LoadingLabel } from "../../components/ui";
import { useEffect, useRef, useState } from "react";
import type { InventoryLocationDto } from "@smartretail/contracts";
import { purchasingApi } from "../../components/purchasing-client";
type Invitation = {
  id: string;
  email: string;
  role: string;
  locationIds: string[];
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};
const roles: Record<string, string> = {
  admin: "Administrador",
  cashier: "Cajero",
  inventory_clerk: "Almacén",
};
export default function InvitationsPanel({
  tenantId,
  onBusy,
  disabled = false,
}: {
  tenantId: string;
  onBusy: (value: boolean) => void;
  disabled?: boolean;
}) {
  const [invitations, setInvitations] = useState<Invitation[]>([]),
    [locations, setLocations] = useState<InventoryLocationDto[]>([]),
    [role, setRole] = useState("cashier"),
    [ids, setIds] = useState<string[]>([]),
    [email, setEmail] = useState(""),
    [days, setDays] = useState("7"),
    [link, setLink] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [observedAt, setObservedAt] = useState(0);
  const sending = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    purchasingApi<{
      invitations: Invitation[];
      locations: InventoryLocationDto[];
    }>("/api/v1/invitations", tenantId, { signal: c.signal })
      .then((v) => {
        if (!c.signal.aborted) {
          setInvitations(v.invitations);
          setObservedAt(Date.now());
          setLocations(v.locations.filter((l) => l.status === "active"));
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(
            e instanceof Error ? e.message : "No pudimos cargar invitaciones.",
          );
          setLoading(false);
        }
      });
    return () => c.abort();
  }, [tenantId, revision]);
  async function run(work: () => Promise<void>) {
    if (sending.current || disabled) return;
    sending.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos confirmar la operación.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section
      className="panel stack"
      aria-labelledby="invitations-title"
      style={{ overflowWrap: "anywhere" }}
    >
      <h2 id="invitations-title">Invitar a tu equipo</h2>
      <p className="muted">
        Comparte un enlace privado. La persona deberá verificar el mismo correo
        antes de aceptar. No enviamos invitaciones por email automáticamente.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setError("");
              setLoading(true);
              setRevision((n) => n + 1);
            }}
          >
            Reintentar consulta
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">Cargando invitaciones…</p>
      ) : (
        <>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                setLink("");
                const result = await purchasingApi<{
                  invitation: Invitation;
                  token: string;
                }>("/api/v1/invitations", tenantId, {
                  method: "POST",
                  body: JSON.stringify({
                    email: email.trim(),
                    role,
                    locationIds: role === "admin" ? [] : ids,
                    expiresInDays: Number(days),
                  }),
                });
                setInvitations((v) => [result.invitation, ...v].slice(0, 100));
                setLink(
                  window.location.origin + "/invite#token=" + result.token,
                );
                setEmail("");
                setNotice(
                  "Invitación creada. Copia el enlace ahora: no se guardará en texto plano.",
                );
              });
            }}
          >
            <fieldset
              disabled={busy || !!error || disabled}
              style={{ minWidth: 0 }}
            >
              <legend>Nuevo acceso</legend>
              <div className="form-grid">
                <label>
                  Correo de la persona
                  <input
                    type="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Rol
                  <select
                    aria-label="Rol de invitación"
                    value={role}
                    onChange={(e) => {
                      setRole(e.target.value);
                      setIds([]);
                    }}
                  >
                    {Object.entries(roles).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <small>
                    {role === "admin"
                      ? "Administra el negocio y todas sus sucursales."
                      : role === "cashier"
                        ? "Vende y opera caja en las sucursales asignadas."
                        : "Consulta y opera existencias en las sucursales asignadas."}
                  </small>
                </label>
                <label>
                  Vigencia en días
                  <input
                    type="number"
                    min={1}
                    max={14}
                    required
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                  />
                  <small>Entre 1 y 14 días. Podrás revocar el enlace.</small>
                </label>
              </div>
              <fieldset style={{ minWidth: 0 }}>
                <legend>Sucursales permitidas</legend>
                {role === "admin" ? (
                  <p>El administrador tiene acceso a todas las sucursales.</p>
                ) : (
                  <>
                    <p>Sin asignaciones no podrá operar caja ni inventario.</p>
                    {locations.map((l) => (
                      <label
                        key={l.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: ".75rem",
                          minHeight: 44,
                        }}
                      >
                        <input
                          type="checkbox"
                          style={{ width: "auto" }}
                          checked={ids.includes(l.id)}
                          onChange={(e) =>
                            setIds((v) =>
                              e.target.checked
                                ? [...v, l.id]
                                : v.filter((x) => x !== l.id),
                            )
                          }
                        />
                        {l.name}
                      </label>
                    ))}
                  </>
                )}
              </fieldset>
              <button>
                <LoadingLabel busy={busy} label="Creando…">
                  Crear invitación
                </LoadingLabel>
              </button>
            </fieldset>
          </form>
          {link && (
            <div className="stack">
              <label>
                Enlace privado · visible sólo ahora
                <input value={link} readOnly autoComplete="off" />
              </label>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(link).then(
                    () =>
                      setNotice(
                        "Enlace copiado. Compártelo sólo con la persona invitada.",
                      ),
                    () =>
                      setNotice("Selecciona y copia el enlace manualmente."),
                  );
                }}
              >
                Copiar enlace de invitación
              </button>
              <p>Si pierdes el enlace, revoca la invitación y crea otra.</p>
            </div>
          )}
          <h3>Invitaciones recientes</h3>
          {!invitations.length ? (
            <p>No hay invitaciones todavía.</p>
          ) : (
            invitations.map((i) => {
              const state = i.acceptedAt
                ? "Aceptada"
                : i.revokedAt
                  ? "Revocada"
                  : new Date(i.expiresAt).getTime() <= observedAt
                    ? "Vencida"
                    : "Pendiente";
              return (
                <article className="card stack" key={i.id}>
                  <strong>{i.email}</strong>
                  <p>
                    {roles[i.role]} · {state}
                  </p>
                  <p>
                    Vence: {new Date(i.expiresAt).toLocaleDateString("es-MX")}
                  </p>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || disabled || state !== "Pendiente"}
                    onClick={() =>
                      void run(async () => {
                        await purchasingApi(
                          "/api/v1/invitations/" + i.id,
                          tenantId,
                          { method: "PATCH", body: "{}" },
                        );
                        setLink("");
                        setRevision((n) => n + 1);
                        setNotice("Invitación revocada.");
                      })
                    }
                  >
                    Revocar invitación
                  </button>
                </article>
              );
            })
          )}
        </>
      )}
    </section>
  );
}

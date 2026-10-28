"use client";
import { LoadingLabel } from "../../components/ui";
import { useEffect, useRef, useState } from "react";
import {
  InvitationEmailStatusSchema,
  type InvitationEmailStatus,
  type InventoryLocationDto,
} from "@smartretail/contracts";
import { purchasingApi } from "../../components/purchasing-client";
import LocationSelector from "../../components/location-selector";
import styles from "../../components/settings-ux.module.css";
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
  composing,
  onComposeChange,
}: {
  tenantId: string;
  onBusy: (value: boolean) => void;
  disabled?: boolean;
  composing?: boolean;
  onComposeChange?: (value: boolean) => void;
}) {
  const [localComposing, setLocalComposing] = useState(false);
  const isComposing = composing ?? localComposing;
  const trigger = useRef<HTMLButtonElement>(null),
    emailInput = useRef<HTMLInputElement>(null);
  function compose(value: boolean) {
    setLocalComposing(value);
    onComposeChange?.(value);
  }
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
    if (isComposing && !loading) emailInput.current?.focus();
  }, [isComposing, loading]);
  function cancel() {
    if (busy || disabled) return;
    setEmail("");
    setRole("cashier");
    setDays("7");
    setIds([]);
    setError("");
    setNotice("");
    // Keep the last creation nonce: cancelling cannot undo an uncertain request.
    compose(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  const creation = useRef<{ intent: string; nonce: string } | null>(null);
  const [linkInvitationId, setLinkInvitationId] = useState("");
  const [emailDelivery, setEmailDelivery] =
    useState<InvitationEmailStatus | null>(null);
  const linkedInvitation = invitations.find((i) => i.id === linkInvitationId);
  const validLink =
    link &&
    linkedInvitation &&
    !linkedInvitation.acceptedAt &&
    !linkedInvitation.revokedAt &&
    Date.parse(linkedInvitation.expiresAt) > observedAt;
  useEffect(() => {
    if (!linkedInvitation) return;
    const remaining = Date.parse(linkedInvitation.expiresAt) - Date.now();
    if (remaining <= 0 || remaining > 2_147_483_646) return;
    const timeout = setTimeout(() => setObservedAt(Date.now()), remaining + 1);
    return () => clearTimeout(timeout);
  }, [linkedInvitation]);
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
      <div className={styles.heading}>
        <h2 id="invitations-title">Invitaciones</h2>
        {composing === undefined && !isComposing && (
          <button
            ref={trigger}
            type="button"
            disabled={disabled || busy || loading}
            onClick={() => compose(true)}
          >
            Invitar empleado
          </button>
        )}
      </div>
      {isComposing && (
        <p className="muted">
          Al crear la invitación intentaremos enviar un correo. También puedes
          compartir su enlace privado. La persona deberá verificar el mismo
          correo antes de aceptar.
        </p>
      )}
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
          {isComposing && (
            <form
              className={`stack ${styles.inviteForm}`}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const intent = {
                    email: email.trim().toLowerCase(),
                    role,
                    locationIds: role === "admin" ? [] : [...ids].sort(),
                    expiresInDays: Number(days),
                  };
                  const fingerprint = JSON.stringify(intent);
                  if (creation.current?.intent !== fingerprint) {
                    const bytes = crypto.getRandomValues(new Uint8Array(32));
                    creation.current = {
                      intent: fingerprint,
                      nonce: Array.from(bytes, (v) =>
                        v.toString(16).padStart(2, "0"),
                      ).join(""),
                    };
                  }
                  const result = await purchasingApi<{
                    invitation: Invitation;
                    token: string;
                    emailDelivery?: { status: InvitationEmailStatus };
                  }>("/api/v1/invitations", tenantId, {
                    method: "POST",
                    body: JSON.stringify({
                      ...intent,
                      creationNonce: creation.current.nonce,
                    }),
                  });
                  setInvitations((v) =>
                    [
                      result.invitation,
                      ...v.filter((i) => i.id !== result.invitation.id),
                    ].slice(0, 100),
                  );
                  setObservedAt(Date.now());
                  setLinkInvitationId(result.invitation.id);
                  setLink(
                    window.location.origin + "/invite#token=" + result.token,
                  );
                  const delivery = InvitationEmailStatusSchema.safeParse(
                    result.emailDelivery?.status,
                  );
                  setEmailDelivery(
                    delivery.success ? delivery.data : "unknown",
                  );
                  setEmail("");
                  creation.current = null;
                  compose(false);
                  requestAnimationFrame(() => trigger.current?.focus());
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
                      ref={emailInput}
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
                      <p>
                        Sin asignaciones no podrá operar caja ni inventario.
                      </p>
                      <LocationSelector
                        locations={locations}
                        selected={ids}
                        onChange={setIds}
                        disabled={busy || !!error || disabled}
                      />
                    </>
                  )}
                </fieldset>
                <div className={styles.actions}>
                  <button>
                    <LoadingLabel busy={busy} label="Creando y enviando…">
                      Crear invitación
                    </LoadingLabel>
                  </button>
                </div>
              </fieldset>
              <button
                type="button"
                className="secondary"
                disabled={busy || disabled}
                onClick={cancel}
              >
                Cancelar invitación
              </button>
            </form>
          )}
          {validLink && (
            <div className="stack">
              <p role={emailDelivery === "unknown" ? "alert" : "status"}>
                {emailDelivery === "accepted"
                  ? "Invitación creada y correo aceptado por el proveedor. Esto no confirma su entrega al buzón."
                  : emailDelivery === "not_sent"
                    ? "Invitación creada, pero el correo no se envió. Comparte el enlace privado."
                    : "Invitación creada. No pudimos confirmar el envío del correo; podría haberse aceptado. No lo repitas: puedes compartir el enlace privado."}
              </p>
              <p>Invitación para {linkedInvitation.email}</p>
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
                        if (i.id === linkInvitationId) {
                          setLink("");
                          setEmailDelivery(null);
                        }
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

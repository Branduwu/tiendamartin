"use client";
import { useEffect, useRef, useState } from "react";
import {
  PersonalProfileSchema,
  type PersonalProfile,
  type PersonalProfileInput,
  type ProfileOverview,
} from "@smartretail/contracts";
import { LoadingLabel } from "../../components/ui";
import { roleLabel } from "../../../lib/navigation";
import styles from "./profile-panel.module.css";
import {
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_MIME,
  PROFILE_PHOTO_HELP,
  PROFILE_PHOTO_ERROR,
} from "../../../lib/profile-photo-policy";

const empty = { firstName: "", lastName: "", phone: "" };
export default function ProfilePanel() {
  const [profile, setProfile] = useState<ProfileOverview>();
  const [draft, setDraft] = useState<PersonalProfileInput>(empty);
  const [editing, setEditing] = useState(false);
  const [photoEditing, setPhotoEditing] = useState(false);
  const photoButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false),
    [version, setVersion] = useState(0);
  const [photoMissing, setPhotoMissing] = useState(false),
    [file, setFile] = useState<File>();
  const [photoUncertain, setPhotoUncertain] = useState(false);
  const [photoReadFailed, setPhotoReadFailed] = useState(false);
  const [preview, setPreview] = useState("");
  const pending = useRef(false),
    previewRef = useRef("");
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (photoEditing) fileInput.current?.focus();
  }, [photoEditing]);
  function closePhotoEditor() {
    setPhotoEditing(false);
    requestAnimationFrame(() => photoButton.current?.focus());
  }
  function cancelPhoto() {
    if (busy || uncertain) return;
    clearSelection();
    setError("");
    setNotice("");
    closePhotoEditor();
  }
  useEffect(() => {
    if (editing) firstInput.current?.focus();
  }, [editing]);
  function finishEditing() {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  }
  function cancelEditing() {
    if (!profile || busy || uncertain) return;
    setDraft({
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phone,
    });
    clearSelection();
    setPhotoEditing(false);
    setError("");
    setNotice("");
    finishEditing();
  }
  function changed() {
    window.dispatchEvent(new Event("smartretail:profile-updated"));
  }
  function clearSelection() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPreview("");
    setFile(undefined);
    if (fileInput.current) fileInput.current.value = "";
  }
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/v1/profile", { cache: "no-store", signal: c.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return (await r.json()) as ProfileOverview;
      })
      .then((value) => {
        if (!c.signal.aborted) {
          setProfile(value);
          setDraft({
            firstName: value.firstName,
            lastName: value.lastName,
            phone: value.phone,
          });
          setLoading(false);
        }
      })
      .catch(() => {
        if (!c.signal.aborted) {
          setError("No pudimos cargar tu perfil. Puedes volver a consultarlo.");
          setLoading(false);
        }
      });
    return () => c.abort();
  }, []);
  const personalDirty =
    !!profile &&
    (draft.firstName !== profile.firstName ||
      draft.lastName !== profile.lastName ||
      draft.phone !== profile.phone);
  const dirty = personalDirty || !!file;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function run(
    work: () => Promise<void>,
    operation: "profile" | "photo" | "read" = "profile",
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch {
      if (operation !== "read") setUncertain(true);
      if (operation === "photo") setPhotoUncertain(true);
      setError(
        operation === "read"
          ? "No pudimos consultar tu perfil. Intenta de nuevo."
          : "No pudimos confirmar el resultado. Consulta tu perfil antes de volver a guardar.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    const preserveDraft = dirty && !uncertain && !photoUncertain;
    await run(async () => {
      const r = await fetch("/api/v1/profile", { cache: "no-store" });
      if (!r.ok) {
        setError("No pudimos consultar tu perfil. Intenta de nuevo.");
        return;
      }
      const value = (await r.json()) as ProfileOverview;
      setProfile(value);
      if (!preserveDraft)
        setDraft({
          firstName: value.firstName,
          lastName: value.lastName,
          phone: value.phone,
        });
      if (value.photoEnabled) {
        const photo = await fetch(`/api/v1/profile/photo?v=${Date.now()}`, {
          cache: "no-store",
        });
        const resolved = photo.status === 200 || photo.status === 404;
        setPhotoReadFailed(!resolved);
        if (!resolved && photoUncertain) {
          setError(
            "No pudimos confirmar la fotografía. Consulta de nuevo antes de repetir el cambio.",
          );
          return;
        }
        if (resolved) setPhotoMissing(photo.status === 404);
      }
      if (!preserveDraft) clearSelection();
      if (!preserveDraft) setPhotoEditing(false);
      setUncertain(false);
      setPhotoUncertain(false);
      setLoading(false);
      setVersion((v) => v + 1);
      setNotice(
        preserveDraft
          ? "Perfil consultado. Tu edición se conserva."
          : "Perfil consultado. Revisa los datos antes de guardar.",
      );
      if (!preserveDraft) finishEditing();
      changed();
    }, "read");
  }
  async function savePhoto(remove = false) {
    await run(async () => {
      if (!remove && !file) return;
      const r = await fetch("/api/v1/profile/photo", {
        method: remove ? "DELETE" : "PUT",
        ...(!remove && file
          ? { headers: { "content-type": file.type }, body: file }
          : {}),
      });
      const body = await r.json();
      if (!r.ok) {
        setUncertain(!!body.code && body.code === "profile_photo_unconfirmed");
        setPhotoUncertain(body.code === "profile_photo_unconfirmed");
        setError(body.error ?? "No pudimos guardar la fotografía.");
        return;
      }
      clearSelection();
      setVersion((v) => v + 1);
      setPhotoMissing(remove);
      setPhotoReadFailed(false);
      setNotice(remove ? "Fotografía eliminada." : "Fotografía guardada.");
      closePhotoEditor();
      changed();
    }, "photo");
  }
  return (
    <section
      id="account-profile"
      className={`panel ${styles.profile}`}
      aria-labelledby="profile-title"
    >
      <h2 id="profile-title" className={styles.sectionTitle}>
        Perfil personal
      </h2>
      {error && (
        <p id="profile-error" className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">Cargando tu perfil…</p>
      ) : !profile ? (
        <button disabled={busy} type="button" onClick={() => void refresh()}>
          Volver a consultar perfil
        </button>
      ) : (
        <>
          <div className={styles.layout}>
            <section
              className={styles.photo}
              aria-label="Identidad de tu cuenta"
            >
              <div className={styles.avatar}>
                {preview ||
                (profile.photoEnabled && !photoMissing && !photoReadFailed) ? (
                  // Authenticated private image; never sent through a public optimizer.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview || `/api/v1/profile/photo?v=${version}`}
                    alt="Tu fotografía de perfil"
                    width={128}
                    height={128}
                    onError={() => {
                      void fetch(`/api/v1/profile/photo?v=${version}`, {
                        cache: "no-store",
                      })
                        .then((r) => {
                          setPhotoMissing(r.status === 404);
                          setPhotoReadFailed(r.status !== 404);
                        })
                        .catch(() => setPhotoReadFailed(true));
                    }}
                  />
                ) : (
                  <span
                    aria-label={
                      photoReadFailed
                        ? "Fotografía no disponible"
                        : "Sin fotografía"
                    }
                  >
                    {(
                      [profile.firstName, profile.lastName]
                        .filter(Boolean)
                        .map((part) => part.slice(0, 1))
                        .join("") || (profile.email || "?").slice(0, 1)
                    ).toUpperCase()}
                  </span>
                )}
              </div>
              <div className={styles.identity}>
                <h3>{profile.displayName || "Tu perfil"}</h3>
                <p>{profile.email}</p>
                <div className={styles.roles} aria-label="Roles actuales">
                  {profile.platformAdmin && (
                    <span className="badge">Administrador global</span>
                  )}
                  {[
                    ...new Set(profile.roles.map((r) => roleLabel(r.role))),
                  ].map((role) => (
                    <span className="badge" key={role}>
                      {role}
                    </span>
                  ))}
                  {!profile.roles.length && !profile.platformAdmin && (
                    <span className="muted">Sin empresa asignada</span>
                  )}
                </div>
                {!profile.photoEnabled && (
                  <small className="muted">Fotografía no habilitada</small>
                )}
              </div>
              <div className={styles.identityActions}>
                <button
                  ref={editButton}
                  type="button"
                  className="secondary"
                  disabled={busy || uncertain || editing}
                  aria-expanded={editing}
                  aria-controls="profile-details"
                  onClick={() => {
                    setDraft({
                      firstName: profile.firstName,
                      lastName: profile.lastName,
                      phone: profile.phone,
                    });
                    setError("");
                    setNotice("");
                    setEditing(true);
                  }}
                >
                  {editing ? "Editando perfil" : "Editar perfil"}
                </button>
                {profile.photoEnabled && (
                  <button
                    ref={photoButton}
                    type="button"
                    className="secondary"
                    disabled={busy || uncertain || photoEditing}
                    aria-expanded={photoEditing}
                    aria-controls="profile-photo-editor"
                    onClick={() => {
                      setError("");
                      setNotice("");
                      setPhotoEditing(true);
                    }}
                  >
                    Cambiar fotografía
                  </button>
                )}
              </div>
              {photoReadFailed && (
                <p role="alert" className="error">
                  No pudimos consultar tu fotografía. No significa que se haya
                  eliminado.
                </p>
              )}
              {profile.photoEnabled && photoEditing && (
                <section
                  id="profile-photo-editor"
                  className={styles.photoEditor}
                  aria-label="Cambiar fotografía"
                  aria-busy={busy}
                >
                  <label>
                    Seleccionar fotografía
                    <input
                      ref={fileInput}
                      type="file"
                      accept={PROFILE_PHOTO_MIME}
                      disabled={busy || uncertain}
                      onChange={(e) => {
                        const selected = e.target.files?.[0];
                        clearSelection();
                        setError("");
                        setNotice("");
                        if (!selected) return;
                        if (
                          selected.type !== PROFILE_PHOTO_MIME ||
                          !selected.size ||
                          selected.size > PROFILE_PHOTO_MAX_BYTES
                        ) {
                          setError(PROFILE_PHOTO_ERROR);
                          return;
                        }
                        const url = URL.createObjectURL(selected);
                        previewRef.current = url;
                        setFile(selected);
                        setPreview(url);
                      }}
                    />
                    <small>{PROFILE_PHOTO_HELP}</small>
                  </label>
                  <button
                    type="button"
                    disabled={!file || busy || uncertain}
                    onClick={() => void savePhoto()}
                  >
                    <LoadingLabel busy={busy} label="Guardando…">
                      Guardar fotografía
                    </LoadingLabel>
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || uncertain}
                    onClick={cancelPhoto}
                  >
                    Cancelar fotografía
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || uncertain || (!preview && photoMissing)}
                    onClick={() => void savePhoto(true)}
                  >
                    Quitar fotografía
                  </button>
                </section>
              )}
            </section>
            <div id="profile-details">
              {!editing ? (
                <section
                  className={styles.details}
                  aria-label="Información personal"
                >
                  <h3>Información personal</h3>
                  <dl className={styles.data}>
                    <div>
                      <dt>Nombre</dt>
                      <dd>{profile.firstName || "Sin completar"}</dd>
                    </div>
                    <div>
                      <dt>Apellidos</dt>
                      <dd>{profile.lastName || "Sin completar"}</dd>
                    </div>
                    <div>
                      <dt>Teléfono de contacto</dt>
                      <dd>{profile.phone || "No registrado"}</dd>
                    </div>
                    <div>
                      <dt>
                        Correo de acceso <small>Solo lectura</small>
                      </dt>
                      <dd>{profile.email}</dd>
                    </div>
                  </dl>
                </section>
              ) : (
                <form
                  className="stack"
                  aria-busy={busy}
                  aria-describedby={error ? "profile-error" : undefined}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (uncertain) return;
                    void run(async () => {
                      const parsed = PersonalProfileSchema.safeParse(draft);
                      if (!parsed.success) {
                        setError(
                          "Revisa nombre, apellidos y teléfono. El nombre es obligatorio.",
                        );
                        return;
                      }
                      const r = await fetch("/api/v1/profile", {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify(parsed.data),
                      });
                      const value = await r.json();
                      if (!r.ok) {
                        setUncertain(
                          value.code === "profile_update_unconfirmed",
                        );
                        setError(
                          value.error ?? "No pudimos guardar tu perfil.",
                        );
                        return;
                      }
                      const saved = value as PersonalProfile;
                      setProfile((current) =>
                        current ? { ...current, ...saved } : current,
                      );
                      setDraft({
                        firstName: saved.firstName,
                        lastName: saved.lastName,
                        phone: saved.phone,
                      });
                      setNotice(
                        file
                          ? "Datos personales guardados. La fotografía seleccionada aún no se ha guardado."
                          : "Datos personales guardados.",
                      );
                      if (!file) finishEditing();
                      changed();
                    });
                  }}
                >
                  <fieldset
                    disabled={busy || uncertain}
                    className={styles.fields}
                  >
                    <legend>Editar datos personales</legend>
                    <label>
                      <span>
                        Nombre <span aria-hidden="true">*</span>
                      </span>
                      <input
                        ref={firstInput}
                        name="firstName"
                        required
                        maxLength={80}
                        autoComplete="given-name"
                        value={draft.firstName}
                        onChange={(e) => {
                          setDraft((v) => ({
                            ...v,
                            firstName: e.target.value,
                          }));
                          setNotice("");
                        }}
                      />
                    </label>
                    <label>
                      Apellidos
                      <input
                        name="lastName"
                        maxLength={80}
                        autoComplete="family-name"
                        value={draft.lastName}
                        onChange={(e) => {
                          setDraft((v) => ({ ...v, lastName: e.target.value }));
                          setNotice("");
                        }}
                      />
                    </label>
                    <label>
                      <span>
                        Teléfono de contacto <small>(opcional)</small>
                      </span>
                      <input
                        name="phone"
                        type="tel"
                        autoComplete="tel"
                        maxLength={40}
                        value={draft.phone}
                        onChange={(e) => {
                          setDraft((v) => ({ ...v, phone: e.target.value }));
                          setNotice("");
                        }}
                      />
                      <small>
                        Dato de contacto; no cambia tu teléfono de
                        autenticación.
                      </small>
                    </label>
                    <div className="actions">
                      <button type="submit" disabled={!personalDirty}>
                        <LoadingLabel busy={busy} label="Guardando…">
                          Guardar cambios
                        </LoadingLabel>
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={cancelEditing}
                      >
                        Cancelar
                      </button>
                    </div>
                  </fieldset>
                </form>
              )}
            </div>
          </div>
          <div className={styles.access}>
            <h3>
              Accesos y permisos <small>Solo lectura</small>
            </h3>
            {profile.platformAdmin && <p>Administrador global</p>}
            {!profile.roles.length && !profile.platformAdmin ? (
              <p>No tienes una empresa asignada.</p>
            ) : (
              profile.roles.map((r, index) => (
                <p key={index}>
                  <strong>{r.company}</strong> · {roleLabel(r.role)}
                  {r.status === "suspended" ? " · Empresa suspendida" : ""}
                </p>
              ))
            )}
            <small>
              El perfil no permite cambiar roles, sucursales ni permisos.
            </small>
          </div>
          {(error || uncertain || photoUncertain || photoReadFailed) && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void refresh()}
            >
              Consultar perfil guardado
            </button>
          )}
        </>
      )}
    </section>
  );
}

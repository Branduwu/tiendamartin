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

const empty = { firstName: "", lastName: "", phone: "" };
export default function ProfilePanel() {
  const [profile, setProfile] = useState<ProfileOverview>();
  const [draft, setDraft] = useState<PersonalProfileInput>(empty);
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
  const dirty =
    !!profile &&
    (draft.firstName !== profile.firstName ||
      draft.lastName !== profile.lastName ||
      draft.phone !== profile.phone ||
      !!file);
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
    await run(async () => {
      const r = await fetch("/api/v1/profile", { cache: "no-store" });
      if (!r.ok) {
        setError("No pudimos consultar tu perfil. Intenta de nuevo.");
        return;
      }
      const value = (await r.json()) as ProfileOverview;
      setProfile(value);
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
      clearSelection();
      setUncertain(false);
      setPhotoUncertain(false);
      setLoading(false);
      setVersion((v) => v + 1);
      setNotice("Perfil consultado. Revisa los datos antes de guardar.");
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
      changed();
    }, "photo");
  }
  return (
    <section className="panel stack" aria-labelledby="profile-title">
      <h2 id="profile-title">Datos personales</h2>
      <p className="muted">
        Estos datos identifican tu cuenta. Tus permisos y accesos a empresas se
        administran por separado.
      </p>
      {error && (
        <p className="error" role="alert">
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
            <section className={styles.photo} aria-labelledby="photo-title">
              <h3 id="photo-title">Fotografía</h3>
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
                    {(profile.displayName || profile.email || "?")
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                )}
              </div>
              {photoReadFailed && (
                <p role="alert" className="error">
                  No pudimos consultar tu fotografía. No significa que se haya
                  eliminado.
                </p>
              )}
              {!profile.photoEnabled ? (
                <p className="muted">
                  La fotografía estará disponible cuando se habilite el
                  almacenamiento de perfiles.
                </p>
              ) : (
                <>
                  <label>
                    Seleccionar fotografía
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy || uncertain}
                      onChange={(e) => {
                        const selected = e.target.files?.[0];
                        clearSelection();
                        setError("");
                        setNotice("");
                        if (!selected) return;
                        if (
                          !["image/jpeg", "image/png", "image/webp"].includes(
                            selected.type,
                          ) ||
                          !selected.size ||
                          selected.size > 3 * 1024 * 1024
                        ) {
                          setError(
                            "Elige una imagen JPEG, PNG o WebP de hasta 3 MB.",
                          );
                          return;
                        }
                        const url = URL.createObjectURL(selected);
                        previewRef.current = url;
                        setFile(selected);
                        setPreview(url);
                      }}
                    />
                    <small>
                      JPEG, PNG o WebP · máximo 3 MB. Sólo tú puedes consultar
                      tu fotografía.
                    </small>
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
                    disabled={busy || uncertain || (!preview && photoMissing)}
                    onClick={() => void savePhoto(true)}
                  >
                    Quitar fotografía
                  </button>
                </>
              )}
            </section>
            <form
              className="stack"
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
                    setUncertain(value.code === "profile_update_unconfirmed");
                    setError(value.error ?? "No pudimos guardar tu perfil.");
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
                  setNotice("Datos personales guardados.");
                  changed();
                });
              }}
            >
              <fieldset disabled={busy || uncertain} className={styles.fields}>
                <legend>Tu información</legend>
                <label>
                  Nombre <span aria-hidden="true">*</span>
                  <input
                    name="firstName"
                    required
                    maxLength={80}
                    autoComplete="given-name"
                    value={draft.firstName}
                    onChange={(e) => {
                      setDraft((v) => ({ ...v, firstName: e.target.value }));
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
                  Teléfono de contacto <small>(opcional)</small>
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
                    Dato de contacto; no cambia tu teléfono de autenticación.
                  </small>
                </label>
                <label>
                  Correo de acceso
                  <input
                    type="email"
                    value={profile.email}
                    readOnly
                    autoComplete="off"
                  />
                  <small>
                    Tu correo no se puede modificar desde este formulario.
                  </small>
                </label>
                <button disabled={!dirty}>
                  <LoadingLabel busy={busy} label="Guardando…">
                    Guardar datos personales
                  </LoadingLabel>
                </button>
              </fieldset>
            </form>
          </div>
          <div className="stack">
            <h3>Tus accesos actuales</h3>
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
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Consultar perfil guardado
          </button>
        </>
      )}
    </section>
  );
}

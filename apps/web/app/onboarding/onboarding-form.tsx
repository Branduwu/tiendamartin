"use client";
import { useEffect, useState, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { OnboardingSchema, type OnboardingInput } from "@smartretail/contracts";
import { purchasingApi } from "../components/purchasing-client";
import { readInvitationToken } from "../../lib/invitation-handoff";
import { roleLanding, type NavigationMembership } from "../../lib/navigation";
export default function OnboardingForm({ actor }: { actor: string }) {
  const router = useRouter(),
    key = "smartretail.onboarding." + actor,
    sending = useRef(false);
  const [ready, setReady] = useState(false),
    [existing, setExisting] = useState(false),
    [step, setStep] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [name, setName] = useState(""),
    [trade, setTrade] = useState(""),
    [phone, setPhone] = useState(""),
    [email, setEmail] = useState(""),
    [branch, setBranch] = useState("Sucursal principal"),
    [pending, setPending] = useState<OnboardingInput | null>(null);
  useEffect(() => {
    const c = new AbortController();
    const start = setTimeout(() => {
      void (async () => {
        try {
          if (readInvitationToken()) {
            router.replace("/invite");
            return;
          }
          const raw = sessionStorage.getItem(key),
            p = raw ? OnboardingSchema.safeParse(JSON.parse(raw)) : null;
          if (p?.success) {
            setPending(p.data);
            setStep(4);
            setName(p.data.businessName);
            setTrade(p.data.tradeName ?? "");
            setPhone(p.data.phone ?? "");
            setEmail(p.data.email ?? "");
            setBranch(p.data.branchName);
          }
          const state = await purchasingApi<{
            completed: boolean;
            tenants: NavigationMembership[];
          }>("/api/v1/onboarding", undefined, { signal: c.signal });
          if (!c.signal.aborted) {
            if (state.completed && !p?.success) {
              const company =
                state.tenants.find((t) => t.tenantStatus !== "suspended") ??
                state.tenants[0];
              const landing = roleLanding(company);
              if (landing !== "/onboarding") {
                router.replace(landing);
                return;
              }
              setExisting(true);
              setReady(true);
              return;
            }
            if (!state.completed && !p?.success) {
              const platform = await fetch("/api/v1/platform", {
                signal: c.signal,
                cache: "no-store",
              });
              if (platform.ok && !c.signal.aborted) {
                router.replace("/platform");
                return;
              }
            }
            setExisting(state.completed);
            setReady(true);
          }
        } catch {
          if (!c.signal.aborted) {
            setError(
              "No pudimos recuperar tu configuración. Recarga para reintentar.",
            );
          }
        }
      })();
    }, 0);
    return () => {
      clearTimeout(start);
      c.abort();
    };
  }, [key, router]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending.current || !ready) return;
    if (step < 4) {
      if ((step === 1 && !name.trim()) || (step === 3 && !branch.trim())) {
        setError("Escribe un nombre para continuar.");
        return;
      }
      setError("");
      setStep((n) => n + 1);
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const parsed = OnboardingSchema.safeParse(
        pending ?? {
          commandId: crypto.randomUUID(),
          businessName: name.trim(),
          tradeName: trade.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          branchName: branch.trim(),
        },
      );
      if (!parsed.success) {
        setError(
          "Revisa el nombre del negocio, los datos de contacto y la sucursal. No uses espacios vacíos ni caracteres invisibles.",
        );
        return;
      }
      const command = parsed.data;
      sessionStorage.setItem(key, JSON.stringify(command));
      setPending(command);
      await purchasingApi("/api/v1/onboarding", undefined, {
        method: "POST",
        body: JSON.stringify(command),
      });
      sessionStorage.removeItem(key);
      // A newly created membership must not reuse a prefetched anonymous route.
      window.location.assign(new URL("/products", window.location.origin).href);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No pudimos confirmar. Reintenta la misma solicitud.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (!ready)
    return (
      <>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p role="status">Comprobando tu acceso…</p>
        )}
      </>
    );
  if (existing && !pending)
    return (
      <div className="panel stack">
        <p>
          Ya tienes acceso a una empresa. Puedes seleccionarla dentro de tu
          espacio de trabajo.
        </p>
        <Link href="/products">Ir a mis empresas</Link>
        <Link href="/invite">Aceptar una invitación</Link>
      </div>
    );
  return (
    <form className="panel stack" onSubmit={submit}>
      <p role="status">
        Paso {step} de 4 ·{" "}
        {
          [
            "",
            "Tu negocio",
            "Datos básicos",
            "Primera sucursal",
            "Confirmación",
          ][step]
        }
      </p>
      <progress
        aria-label="Progreso de configuración"
        max={4}
        value={step}
        style={{ width: "100%" }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy || pending !== null} style={{ minWidth: 0 }}>
        <legend>
          {
            [
              "",
              "Nombre del negocio",
              "Datos opcionales",
              "Sucursal",
              "Revisa tus datos",
            ][step]
          }
        </legend>
        {step === 1 && (
          <label>
            Nombre del negocio
            <input
              aria-label="Nombre del negocio"
              aria-describedby="business-name-help"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
            <small id="business-name-help">
              El nombre que identifica a tu empresa.
            </small>
          </label>
        )}
        {step === 2 && (
          <div className="stack">
            <label>
              Nombre comercial
              <input
                aria-label="Nombre comercial"
                aria-describedby="trade-name-help"
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
                maxLength={120}
              />
              <small id="trade-name-help">
                Opcional. Se mostrará en tus tickets.
              </small>
            </label>
            <label>
              Teléfono
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={50}
              />
            </label>
            <label>
              Correo del negocio
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
              />
            </label>
          </div>
        )}
        {step === 3 && (
          <label>
            Nombre de la primera sucursal
            <input
              aria-label="Nombre de la primera sucursal"
              aria-describedby="branch-name-help"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              required
              maxLength={100}
            />
            <small id="branch-name-help">
              Podrás configurar otras sucursales más adelante.
            </small>
          </label>
        )}
        {step === 4 && (
          <div className="stack">
            <p>
              Empresa: <strong>{name}</strong>
            </p>
            <p>Nombre comercial: {trade || name}</p>
            <p>
              Sucursal: <strong>{branch}</strong>
            </p>
            <p>Moneda: MXN · Zona horaria: Ciudad de México</p>
            <p>
              Tu usuario será el propietario. No se crearán productos ni ventas
              de ejemplo.
            </p>
          </div>
        )}
      </fieldset>
      {pending && (
        <p role="status">
          Hay una solicitud pendiente. Reintentar conservará los mismos datos y
          evitará duplicar tu empresa.
        </p>
      )}
      <div className="row-actions">
        {step > 1 && !pending && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setStep((n) => n - 1)}
          >
            Atrás
          </button>
        )}
        <button disabled={busy}>
          {busy
            ? "Confirmando…"
            : step === 4
              ? pending
                ? "Reintentar configuración"
                : "Crear mi empresa"
              : "Continuar"}
        </button>
      </div>
    </form>
  );
}

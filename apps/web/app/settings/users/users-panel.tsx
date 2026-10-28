"use client";
import { LoadingLabel } from "../../components/ui";
import { selectCompany } from "../../../lib/company-selection";
import { useEffect, useRef, useState } from "react";
import type { InventoryLocationDto } from "@smartretail/contracts";
import AppNavigation from "../../components/app-navigation";
import { purchasingApi } from "../../components/purchasing-client";
import InvitationsPanel from "./invitations-panel";
import LocationSelector from "../../components/location-selector";
import SettingsSections from "../../components/settings-sections";
import styles from "../../components/settings-ux.module.css";

type Member = {
  userId: string;
  displayName: string;
  role: "owner" | "admin" | "cashier" | "inventory_clerk";
  status: "active" | "inactive";
  locationIds: string[];
  allLocations: boolean;
};
type Company = {
  tenantId: string;
  tenantName?: string;
  userId: string;
  permissions: string[];
};
const roles = {
  owner: "Propietario",
  admin: "Administrador",
  cashier: "Cajero",
  inventory_clerk: "Almacén",
};

function MemberEditor({
  member,
  locations,
  tenantId,
  onSaved,
  onCancel,
}: {
  member: Member;
  locations: InventoryLocationDto[];
  tenantId: string;
  onSaved: (value: Member) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(member.displayName);
  const [role, setRole] = useState(member.role);
  const [status, setStatus] = useState(member.status);
  const [ids, setIds] = useState(member.locationIds);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sending = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstInput.current?.focus();
  }, []);
  const all = role === "admin";
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (sending.current) return;
        sending.current = true;
        setBusy(true);
        setError("");
        try {
          const result = await purchasingApi<{ member: Member }>(
            `/api/v1/members/${member.userId}`,
            tenantId,
            {
              method: "PATCH",
              body: JSON.stringify({
                displayName: name.trim(),
                role,
                status,
                locationIds: all ? [] : ids,
              }),
            },
          );
          onSaved(result.member);
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "No pudimos guardar el usuario.",
          );
        } finally {
          sending.current = false;
          setBusy(false);
        }
      }}
    >
      <h2>Editar usuario</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy} style={{ minWidth: 0 }}>
        <legend>Identidad y acceso</legend>
        <div className="form-grid">
          <label>
            Nombre operativo
            <input
              ref={firstInput}
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Rol
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Member["role"])}
            >
              <option value="admin">Administrador</option>
              <option value="cashier">Cajero</option>
              <option value="inventory_clerk">Almacén</option>
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
            Estado
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Member["status"])}
            >
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
        </div>
        <fieldset style={{ minWidth: 0 }}>
          <legend>Ubicaciones permitidas</legend>
          {all ? (
            <p>El administrador tiene acceso a todas las ubicaciones.</p>
          ) : (
            <>
              <p>
                Sin ubicaciones asignadas no podrá operar caja ni existencias.
              </p>
              <LocationSelector
                locations={locations}
                selected={ids}
                onChange={setIds}
                disabled={busy}
              />
            </>
          )}
        </fieldset>
        <div className="row-actions">
          <button>
            <LoadingLabel busy={busy} label="Guardando…">
              Guardar cambios
            </LoadingLabel>
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function CompanyMembers({
  tenantId,
  userId,
  onEditing,
}: {
  tenantId: string;
  userId: string;
  onEditing: (editing: boolean) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [locations, setLocations] = useState<InventoryLocationDto[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Member | null>(null),
    [refresh, setRefresh] = useState(0);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  function closeEditor() {
    setEditing(null);
    onEditing(false);
    requestAnimationFrame(() => editTrigger.current?.focus());
  }
  useEffect(() => {
    const controller = new AbortController();
    purchasingApi<{ members: Member[]; locations: InventoryLocationDto[] }>(
      "/api/v1/members",
      tenantId,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setMembers(result.members);
          setLocations(result.locations);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(
            e instanceof Error ? e.message : "No pudimos cargar usuarios.",
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [tenantId, refresh]);
  if (loading) return <p role="status">Cargando usuarios…</p>;
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <button
            className="secondary"
            onClick={() => {
              setError("");
              setLoading(true);
              setRefresh((n) => n + 1);
            }}
          >
            Reintentar
          </button>
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {editing && (
        <MemberEditor
          key={editing.userId}
          member={editing}
          locations={locations}
          tenantId={tenantId}
          onCancel={closeEditor}
          onSaved={(member) => {
            setMembers((current) =>
              current.map((m) => (m.userId === member.userId ? member : m)),
            );
            closeEditor();
            setNotice("Acceso del usuario actualizado.");
          }}
        />
      )}
      {!members.length && !error ? (
        <p>No hay usuarios disponibles.</p>
      ) : (
        <div className="table-scroll responsive-table">
          <table className="data-table">
            <thead>
              <tr>
                {["Usuario", "Rol", "Estado", "Ubicaciones", "Acciones"].map(
                  (text) => (
                    <th scope="col" key={text}>
                      {text}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <td data-label="Usuario">
                    {member.displayName || "Usuario registrado"}
                    {member.userId === userId && <small> · Tú</small>}
                  </td>
                  <td data-label="Rol">{roles[member.role]}</td>
                  <td data-label="Estado">
                    <span
                      className={`badge ${member.status === "active" ? "active" : ""}`}
                    >
                      {member.status === "active" ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td data-label="Ubicaciones">
                    {member.allLocations
                      ? "Todas las ubicaciones"
                      : member.locationIds.length
                        ? member.locationIds
                            .map(
                              (id) =>
                                locations.find((l) => l.id === id)?.name ??
                                "Ubicación registrada",
                            )
                            .join(", ")
                        : "Sin asignar"}
                  </td>
                  <td data-label="Acciones">
                    <button
                      className="secondary"
                      disabled={
                        !userId ||
                        member.role === "owner" ||
                        member.userId === userId ||
                        editing !== null
                      }
                      onClick={(e) => {
                        editTrigger.current = e.currentTarget;
                        setNotice("");
                        setEditing(member);
                        onEditing(true);
                      }}
                      aria-label={`Editar acceso de ${member.displayName || "usuario"}`}
                    >
                      Editar acceso
                    </button>
                    {(member.role === "owner" || member.userId === userId) && (
                      <small> Acceso protegido</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function UsersPanel() {
  const [editing, setEditing] = useState(false),
    [inviting, setInviting] = useState(false);
  const [section, setSection] = useState("members"),
    [composing, setComposing] = useState(false);
  const inviteTrigger = useRef<HTMLButtonElement>(null),
    returnInviteFocus = useRef(false);
  useEffect(() => {
    if (returnInviteFocus.current && !composing && !inviting) {
      inviteTrigger.current?.focus();
      returnInviteFocus.current = false;
    }
  }, [composing, inviting]);
  const [companies, setCompanies] = useState<Company[]>([]),
    [tenantId, setTenantId] = useState("");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    purchasingApi<{ tenants: Company[] }>("/api/v1/tenants", undefined, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          const allowed = result.tenants.filter((t) =>
            t.permissions.includes("members.manage"),
          );
          setCompanies(allowed);
          setTenantId(selectCompany(allowed));
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("No pudimos cargar tus empresas. Recarga para reintentar.");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);
  const company = companies.find((c) => c.tenantId === tenantId);
  return (
    <>
      <header className="topbar">
        <strong>SmartRetail</strong>
        <AppNavigation
          blocked={editing || inviting || composing}
          tenantId={tenantId}
          current="/settings/users"
          permissions={company?.permissions ?? []}
        />
      </header>
      <main
        id="workspace-content"
        tabIndex={-1}
        className={`workspace ${styles.workspace}`}
      >
        <div className={styles.heading}>
          <div>
            <h1>Equipo</h1>
            <p className="muted">
              Administra roles, estado y ubicaciones de los usuarios de tu
              empresa.
            </p>
          </div>
          {company && (
            <button
              ref={inviteTrigger}
              type="button"
              disabled={editing || inviting || composing}
              onClick={() => {
                returnInviteFocus.current = true;
                setSection("invitations");
                setComposing(true);
              }}
            >
              Invitar empleado
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Cargando empresas…</p>
        ) : !companies.length ? (
          <p>No tienes permiso para administrar usuarios.</p>
        ) : (
          <>
            <label hidden>
              Empresa
              <select
                aria-label="Empresa"
                disabled={editing || inviting || composing}
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              >
                {companies.map((c, index) => (
                  <option key={c.tenantId} value={c.tenantId}>
                    {c.tenantName || `Empresa ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            {company && (
              <SettingsSections
                id="team"
                label="Secciones del equipo"
                items={[
                  { id: "members", label: "Miembros" },
                  { id: "invitations", label: "Invitaciones" },
                ]}
                value={section}
                onChange={setSection}
                disabled={editing || inviting || composing}
              />
            )}
            <div
              id="team-panel-members"
              role="tabpanel"
              aria-labelledby="team-tab-members"
              hidden={section !== "members"}
            >
              {company && (
                <CompanyMembers
                  key={tenantId}
                  tenantId={tenantId}
                  userId={company.userId}
                  onEditing={setEditing}
                />
              )}
            </div>
            <div
              id="team-panel-invitations"
              role="tabpanel"
              aria-labelledby="team-tab-invitations"
              hidden={section !== "invitations"}
            >
              {company && (
                <InvitationsPanel
                  key={"invite-" + tenantId}
                  tenantId={tenantId}
                  onBusy={setInviting}
                  disabled={editing}
                  composing={composing}
                  onComposeChange={setComposing}
                />
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}

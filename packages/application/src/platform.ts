export type PlatformCompany = Readonly<{
  id: string;
  displayName: string;
  status: "active" | "suspended";
  createdAt: string;
  owner: string;
  userCount: number;
}>;
export type PlatformOverview = Readonly<{
  summary: { total: number; active: number; suspended: number };
  companies: PlatformCompany[];
}>;
export type PlatformCompanyDetail = Readonly<{
  id: string;
  displayName: string;
  status: "active" | "suspended";
  createdAt: string;
  profile: {
    businessName: string;
    tradeName: string | null;
    timezone: string;
    currency: "MXN";
  } | null;
  members: { name: string; role: string; status: string }[];
  branches: { name: string; status: string }[];
}>;
export class PlatformCompanyNotFoundError extends Error {}
export class PlatformCompanyConflictError extends Error {}
export const SUSPENDED_COMPANY_MESSAGE =
  "Esta empresa se encuentra suspendida. Contacta al administrador.";

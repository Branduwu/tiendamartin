export type BusinessProfile = Readonly<{
  businessName: string;
  tradeName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  ticketFooter: string | null;
  logoUrl: null;
  timezone: string;
  locale: "es-MX" | "en-US";
  currency: "MXN";
}>;
export type BranchSettings = Readonly<{
  id: string;
  name: string;
  code: string;
  displayName: string | null;
  address: string | null;
  phone: string | null;
  receiptHeader: string | null;
  status: "active" | "inactive";
}>;
export type BranchUpdate = Pick<
  BranchSettings,
  "displayName" | "address" | "phone" | "receiptHeader" | "status"
>;
export const defaultBusinessProfile: BusinessProfile = Object.freeze({
  businessName: "Mi negocio",
  tradeName: null,
  phone: null,
  email: null,
  website: null,
  ticketFooter: null,
  logoUrl: null,
  timezone: "America/Mexico_City",
  locale: "es-MX",
  currency: "MXN",
});
export class BusinessSettingsNotFoundError extends Error {}

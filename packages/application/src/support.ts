export type SupportCategory =
  "function" | "error" | "billing" | "suggestion" | "other";
export type SupportStatus = "open" | "in_progress" | "resolved" | "closed";
export type SupportSummary = Readonly<{
  id: string;
  tenantId: string;
  tenantName: string;
  createdByUserId: string;
  createdByName: string;
  createdByRole: string;
  category: SupportCategory;
  subject: string;
  status: SupportStatus;
  createdAt: string;
  updatedAt: string;
}>;
export type SupportRequest = SupportSummary &
  Readonly<{ description: string; pagePath: string }>;
export type CreateSupportRequest = Readonly<{
  id: string;
  category: SupportCategory;
  subject: string;
  description: string;
  pagePath: string;
}>;
export type InitialSetup = Readonly<{
  company: boolean;
  branch: boolean;
  product: boolean;
  inventory: boolean;
  team: boolean;
  taxes: boolean;
  cash: boolean;
  sale: boolean;
}>;
export class SupportUnavailableError extends Error {}
export class SupportConflictError extends Error {}
export class SupportRateLimitError extends Error {}
export interface SupportRepository {
  create(
    value: CreateSupportRequest,
    correlation: string,
  ): Promise<SupportRequest>;
  list(
    page?: number,
    status?: SupportStatus,
  ): Promise<{ requests: SupportSummary[]; hasMore: boolean }>;
  detail(id: string): Promise<SupportRequest>;
  changeStatus(
    id: string,
    status: SupportStatus,
    correlation: string,
  ): Promise<SupportRequest>;
  initialSetup(): Promise<InitialSetup>;
}

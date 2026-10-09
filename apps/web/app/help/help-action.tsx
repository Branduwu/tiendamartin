"use client";
import Link from "next/link";
import { companyHref } from "../../lib/company-selection";
import { usePurchasingCompany } from "../components/purchasing-client";
export default function HelpAction({
  action,
}: {
  action: { href: string; label: string; permission: string };
}) {
  const { tenantId, permissions } = usePurchasingCompany();
  return permissions.includes(action.permission) ? (
    <Link className="button" href={companyHref(action.href, tenantId)}>
      {action.label}
    </Link>
  ) : null;
}

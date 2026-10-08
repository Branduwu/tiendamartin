import { notFound } from "next/navigation";
import { UuidSchema } from "@smartretail/contracts";
import { PlatformCompanyNotFoundError } from "@smartretail/application";
import { verifiedUserId } from "../../../../lib/auth";
import { platformForUser } from "../../../../lib/database";
import CompanyDetail from "../company-detail";
export default async function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await verifiedUserId();
  if (!actor || !(await platformForUser(actor).access())) return null;
  const id = UuidSchema.safeParse((await params).id);
  if (!id.success) notFound();
  let company;
  try {
    company = await platformForUser(actor).detail(id.data);
  } catch (e) {
    if (e instanceof PlatformCompanyNotFoundError) notFound();
    throw e;
  }
  return <CompanyDetail key={company.id} initial={company} actor={actor} />;
}

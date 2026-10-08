import { verifiedUserId } from "../../../lib/auth";
import { platformForUser } from "../../../lib/database";
import CompanyList from "./company-list";
export default async function CompaniesPage() {
  const actor = await verifiedUserId();
  if (!actor || !(await platformForUser(actor).access())) return null;
  return <CompanyList actor={actor} />;
}

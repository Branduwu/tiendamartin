import { redirect } from "next/navigation";
import { verifiedUserId } from "../../lib/auth";
import { labelQuery } from "../../lib/product-labels";
import LabelsPanel from "./labels-panel";
import "./labels.css";

export const dynamic = "force-dynamic";

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await verifiedUserId())) redirect("/login");
  const query = labelQuery(await searchParams);
  return <LabelsPanel key={JSON.stringify(query)} {...query} />;
}

import type { BusinessProfile } from "@smartretail/application";
export default function TicketIdentity({
  profile,
  branch,
}: {
  profile: BusinessProfile;
  branch?: {
    name: string;
    displayName: string | null;
    address: string | null;
    phone: string | null;
    receiptHeader: string | null;
  };
}) {
  return (
    <>
      <h1>{profile.tradeName ?? profile.businessName}</h1>
      {branch && (
        <>
          <p>Sucursal: {branch.displayName ?? branch.name}</p>
          {branch.receiptHeader && <p>{branch.receiptHeader}</p>}
          {branch.address && <p>{branch.address}</p>}
        </>
      )}
      {(branch?.phone ?? profile.phone) && (
        <p>Teléfono: {branch?.phone ?? profile.phone}</p>
      )}
    </>
  );
}

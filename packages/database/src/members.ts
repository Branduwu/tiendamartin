import type { Pool, PoolClient } from "pg";
import { productId } from "@smartretail/domain";
import type { AuthenticatedContext } from "@smartretail/application";
import { PostgresInventory } from "./database";

export type MemberRole = "owner" | "admin" | "cashier" | "inventory_clerk";
export type Member = Readonly<{
  userId: string;
  displayName: string;
  role: MemberRole;
  status: "active" | "inactive";
  locationIds: readonly string[];
  allLocations: boolean;
}>;
export type MemberUpdate = Readonly<{
  displayName: string;
  role: Exclude<MemberRole, "owner">;
  status: "active" | "inactive";
  locationIds: readonly string[];
}>;
export class MemberNotFoundError extends Error {}
export class MemberStateConflictError extends Error {}
type MemberRow = {
  user_id: string;
  display_name: string | null;
  role: MemberRole;
  status: "active" | "inactive";
  location_ids: string[];
  all_locations: boolean;
};
const mapped = (row: MemberRow): Member =>
  Object.freeze({
    userId: row.user_id,
    displayName: row.display_name ?? "Usuario",
    role: row.role,
    status: row.status,
    locationIds: Object.freeze([...row.location_ids]),
    allLocations: row.all_locations,
  });

export class PostgresMembers extends PostgresInventory {
  private readonly correlation: string;
  constructor(
    pool: Pool,
    context: AuthenticatedContext,
    correlation = globalThis.crypto.randomUUID(),
  ) {
    super(pool, context);
    this.correlation = productId(correlation).toLowerCase();
  }
  private async members(client: PoolClient): Promise<readonly Member[]> {
    const result = await client.query<MemberRow>(
      "SELECT * FROM retail.list_members()",
    );
    return result.rows.map(mapped);
  }
  listMembers(): Promise<readonly Member[]> {
    return this.transaction("members.manage", (client) => this.members(client));
  }
  async updateMember(id: string, input: MemberUpdate): Promise<Member> {
    const target = productId(id).toLowerCase();
    if (
      !["admin", "cashier", "inventory_clerk"].includes(input.role) ||
      !["active", "inactive"].includes(input.status) ||
      typeof input.displayName !== "string" ||
      input.displayName.length < 1 ||
      input.displayName.length > 80 ||
      input.displayName.trim() !== input.displayName ||
      !/[^\p{M}\p{Z}]/u.test(input.displayName) ||
      /[\p{Cc}\p{Cs}\p{Cf}]/u.test(input.displayName) ||
      !Array.isArray(input.locationIds) ||
      input.locationIds.length > 100 ||
      (input.role === "admin" && input.locationIds.length !== 0)
    )
      throw new TypeError("Invalid member update");
    const locations = input.locationIds.map((location) =>
      productId(location).toLowerCase(),
    );
    if (new Set(locations).size !== locations.length)
      throw new TypeError("Duplicate member locations");
    try {
      return await this.transaction("members.manage", async (client) => {
        await client.query(
          "SELECT retail.update_member($1,$2,$3,$4,$5::uuid[],$6)",
          [
            target,
            input.role,
            input.status,
            input.displayName,
            locations,
            this.correlation,
          ],
        );
        const member = (await this.members(client)).find(
          (value) => value.userId === target,
        );
        if (!member) throw new MemberNotFoundError();
        return member;
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P0001")
        throw new MemberStateConflictError();
      throw error;
    }
  }
}

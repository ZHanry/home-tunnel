import { query } from "./db.js";

function selectConnectionFields(includeManagementFields: boolean): string {
  const managementFields = includeManagementFields ? ",u.username,d.name AS device_name" : "";
  const managementJoins = includeManagementFields
    ? "JOIN users u ON u.id=c.user_id JOIN devices d ON d.id=c.device_id"
    : "";
  return `
    SELECT c.*${managementFields},rs.state,rs.applied_version,rs.last_error_code,
           tp.bandwidth_limit_bps,tp.version AS policy_version
      FROM connections c
      ${managementJoins}
      LEFT JOIN runtime_states rs ON rs.connection_id=c.id
      LEFT JOIN traffic_policies tp ON tp.scope_type='connection' AND tp.scope_id=c.id`;
}

// The client and administrator views intentionally share runtime/policy joins.
// Management-only names stay opt-in so the existing client JSON surface does
// not gain fields that were previously omitted by JSON serialization.
export const clientConnectionSelect = selectConnectionFields(false);
export const adminConnectionSelect = selectConnectionFields(true);

export async function customDomainsByConnection(
  connectionIds: string[],
): Promise<Map<string, string[]>> {
  if (!connectionIds.length) return new Map();
  const rows = await query<{ connection_id: string; domain: string }>(
    `SELECT connection_id,domain FROM custom_domains
      WHERE status='verified' AND connection_id IN (${connectionIds.map(() => "?").join(",")})
      ORDER BY domain`,
    connectionIds,
  );
  const result = new Map<string, string[]>();
  for (const row of rows)
    result.set(row.connection_id, [...(result.get(row.connection_id) ?? []), row.domain]);
  return result;
}

import { getRequestSession } from "./server";
import { API_SCOPES, apiKeyPrefix, hashApiKey, randomApiToken, type ApiKeyAuthentication, type ApiScope } from "../domain/api-keys";
import { createStorageClient } from "../storage";
export { API_SCOPES, apiKeyPrefix, hashApiKey, type ApiScope } from "../domain/api-keys";

export interface ApiAccessContext {
  authType: "session" | "api-key";
  userId: string;
  householdId: string;
  scopes: Set<ApiScope>;
  apiKeyId?: string;
}

export async function createApiKey(db: D1Database, input: { userId: string; householdId: string; name: string; environment: "test" | "live"; scopes: ApiScope[]; expiresAt?: string }) {
  const id = crypto.randomUUID();
  const key = `mp_${input.environment}_${randomApiToken()}`;
  await db.prepare("INSERT INTO api_keys (id, user_id, household_id, name, key_prefix, key_hash, scopes_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, input.userId, input.householdId, input.name, apiKeyPrefix(key), await hashApiKey(key), JSON.stringify(input.scopes), input.expiresAt ?? null).run();
  return { id, key };
}

export async function listApiKeys(db: D1Database, userId: string) {
  const result = await db.prepare("SELECT id, name, key_prefix, scopes_json, expires_at, last_used_at, revoked_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all<{
    id: string; name: string; key_prefix: string; scopes_json: string; expires_at: string | null; last_used_at: string | null; revoked_at: string | null; created_at: string;
  }>();
  return result.results.map((row) => ({ id: row.id, name: row.name, prefix: row.key_prefix, scopes: JSON.parse(row.scopes_json) as ApiScope[], expiresAt: row.expires_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at, createdAt: row.created_at }));
}

export async function revokeApiKey(db: D1Database, userId: string, keyId: string) {
  await db.prepare("UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").bind(keyId, userId).run();
}

export async function authenticateApiKeyWithD1(db: D1Database, key: string): Promise<ApiKeyAuthentication | null> {
  const row = await db.prepare(`
    SELECT k.id, k.user_id, k.household_id, k.scopes_json
    FROM api_keys k
    INNER JOIN household_memberships membership
      ON membership.user_id = k.user_id AND membership.household_id = k.household_id
    WHERE k.key_prefix = ? AND k.key_hash = ? AND k.revoked_at IS NULL
      AND (k.expires_at IS NULL OR k.expires_at > CURRENT_TIMESTAMP)
    LIMIT 1
  `).bind(apiKeyPrefix(key), await hashApiKey(key)).first<{ id: string; user_id: string; household_id: string; scopes_json: string }>();
  if (!row) return null;
  await db.prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
  const scopes = JSON.parse(row.scopes_json) as unknown;
  return {
    id: row.id,
    userId: row.user_id,
    householdId: row.household_id,
    scopes: Array.isArray(scopes) ? scopes.filter((scope): scope is ApiScope => API_SCOPES.includes(scope as ApiScope)) : [],
  };
}

export async function authenticateApiRequest(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext): Promise<ApiAccessContext | null> {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer mp_")) {
    const key = header.slice("Bearer ".length);
    const authenticated = await createStorageClient(env).authenticateApiKey(key);
    if (!authenticated) return null;
    return { authType: "api-key", userId: authenticated.userId, householdId: authenticated.householdId, scopes: new Set(authenticated.scopes), apiKeyId: authenticated.id };
  }
  const session = await getRequestSession(request, env, ctx);
  return session ? { authType: "session", userId: session.user.id, householdId: session.householdId, scopes: new Set(API_SCOPES) } : null;
}

export async function requireApiScope(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext, scope: ApiScope): Promise<ApiAccessContext | Response> {
  const access = await authenticateApiRequest(request, env, ctx);
  if (!access) return Response.json({ code: "unauthorized", message: "A valid session or API key is required" }, { status: 401 });
  if (!access.scopes.has(scope)) return Response.json({ code: "forbidden", message: `Scope ${scope} is required` }, { status: 403 });
  return access;
}

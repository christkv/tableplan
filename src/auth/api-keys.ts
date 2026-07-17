import { getRequestSession } from "./server";

export const API_SCOPES = ["recipes:read", "recipes:write", "plans:read", "plans:write", "shopping:read", "shopping:write", "household:read", "admin:import"] as const;
export type ApiScope = typeof API_SCOPES[number];

export interface ApiAccessContext {
  authType: "session" | "api-key";
  userId: string;
  householdId: string;
  scopes: Set<ApiScope>;
  apiKeyId?: string;
}

const encoder = new TextEncoder();

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function apiKeyPrefix(key: string): string {
  return key.slice(0, 20);
}

export async function createApiKey(db: D1Database, input: { userId: string; householdId: string; name: string; environment: "test" | "live"; scopes: ApiScope[]; expiresAt?: string }) {
  const id = crypto.randomUUID();
  const key = `mp_${input.environment}_${randomToken()}`;
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

export async function authenticateApiRequest(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext): Promise<ApiAccessContext | null> {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer mp_")) {
    const key = header.slice("Bearer ".length);
    const row = await env.DB.prepare("SELECT id, user_id, household_id, key_hash, scopes_json, expires_at, revoked_at FROM api_keys WHERE key_prefix = ?")
      .bind(apiKeyPrefix(key)).first<{ id: string; user_id: string; household_id: string | null; key_hash: string; scopes_json: string; expires_at: string | null; revoked_at: string | null }>();
    if (!row || row.revoked_at || !row.household_id || row.key_hash !== await hashApiKey(key)) return null;
    if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;
    ctx.waitUntil(env.DB.prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run().then(() => undefined));
    return { authType: "api-key", userId: row.user_id, householdId: row.household_id, scopes: new Set(JSON.parse(row.scopes_json) as ApiScope[]), apiKeyId: row.id };
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

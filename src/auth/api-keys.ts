import { getRequestSession } from "./server";
import { API_SCOPES, type ApiScope } from "../domain/api-keys";
import { createStorageClient } from "../storage";
export { API_SCOPES, apiKeyPrefix, hashApiKey, type ApiScope } from "../domain/api-keys";

export interface ApiAccessContext {
  authType: "session" | "api-key";
  userId: string;
  householdId: string;
  scopes: Set<ApiScope>;
  apiKeyId?: string;
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

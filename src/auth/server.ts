import { redirect } from "react-router";
import { createStorageClient } from "../storage";
import { resolveMongoGatewayTransport, type MongoGatewayEnvironment } from "../storage/gateway-transport";

interface AuthSession {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; [key: string]: unknown };
}

function gatewayUrl(baseUrl: string, requestUrl: string): string {
  const source = new URL(requestUrl); const target = new URL(baseUrl);
  target.pathname = source.pathname; target.search = source.search;
  return target.toString();
}

export async function handleAuthRequest(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext): Promise<Response> {
  void ctx;
  const transport = resolveMongoGatewayTransport(env as CloudflareEnvironment & MongoGatewayEnvironment);
  const headers = new Headers(request.headers); headers.delete("host");
  headers.set("x-forwarded-origin", new URL(request.url).origin);
  const serviceToken = (env as unknown as { MONGODB_GATEWAY_SERVICE_TOKEN?: string }).MONGODB_GATEWAY_SERVICE_TOKEN;
  if (!serviceToken) throw new Error("MONGODB_GATEWAY_SERVICE_TOKEN is required for gateway-backed authentication");
  headers.set("x-tableplan-service-token", `Bearer ${serviceToken}`);
  const fetcher = transport.fetcher;
  return fetcher(new Request(gatewayUrl(transport.baseUrl, request.url), { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body, redirect: "manual", duplex: request.method === "GET" || request.method === "HEAD" ? undefined : "half" } as RequestInit));
}

export async function getAuthSession(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext): Promise<AuthSession | null> {
  const sessionRequest = new Request(new URL("/api/auth/get-session", request.url), { headers: request.headers });
  const response = await handleAuthRequest(sessionRequest, env, ctx);
  if (!response.ok) return null;
  return await response.json() as AuthSession | null;
}

export async function getRequestSession(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext) {
  const session = await getAuthSession(request, env, ctx);
  if (!session) return null;
  const householdId = await createStorageClient(env).ensureUserHousehold(session.user);
  return { ...session, householdId };
}

export async function requireRequestSession(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext) {
  const session = await getRequestSession(request, env, ctx);
  if (!session) throw redirect("/sign-in");
  return session;
}

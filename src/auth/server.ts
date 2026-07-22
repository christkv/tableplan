import { redirect } from "react-router";
import { createStorageClient } from "../storage";
import { resolveMongoGatewayTransport, type MongoGatewayEnvironment } from "../storage/gateway-transport";
import { createLogger, errorLogContext } from "../observability/logger";

interface AuthSession {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; [key: string]: unknown };
}

function gatewayUrl(baseUrl: string, requestUrl: string): string {
  const source = new URL(requestUrl); const target = new URL(baseUrl);
  target.pathname = source.pathname; target.search = source.search;
  return target.toString();
}

function isOAuthCallback(request: Request): boolean {
  return request.method === "GET" && /^\/api\/auth\/callback\/[^/]+$/.test(new URL(request.url).pathname);
}

function authErrorRedirect(request: Request, error: string, requestId: string): Response {
  const target = new URL("/auth/error", request.url);
  target.searchParams.set("error", error);
  target.searchParams.set("request_id", requestId);
  return Response.redirect(target, 302);
}

function mutableGatewayResponse(response: Response, headers: Headers = new Headers(response.headers)): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleAuthRequest(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext): Promise<Response> {
  void ctx;
  const logger = createLogger(env, "auth-proxy");
  const requestId = crypto.randomUUID();
  const path = new URL(request.url).pathname;
  try {
    const transport = resolveMongoGatewayTransport(env as CloudflareEnvironment & MongoGatewayEnvironment);
    const headers = new Headers(request.headers); headers.delete("host");
    headers.set("x-forwarded-origin", new URL(request.url).origin);
    headers.set("x-request-id", requestId);
    const serviceToken = (env as unknown as { MONGODB_GATEWAY_SERVICE_TOKEN?: string }).MONGODB_GATEWAY_SERVICE_TOKEN;
    if (!serviceToken) throw new Error("MONGODB_GATEWAY_SERVICE_TOKEN is required for gateway-backed authentication");
    headers.set("x-tableplan-service-token", `Bearer ${serviceToken}`);
    const fetcher = transport.fetcher;
    const response = await fetcher(new Request(gatewayUrl(transport.baseUrl, request.url), { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body, redirect: "manual", duplex: request.method === "GET" || request.method === "HEAD" ? undefined : "half" } as RequestInit));
    const location = response.headers.get("location");
    const redirectTarget = location ? new URL(location, request.url) : null;
    const errorCode = redirectTarget?.searchParams.get("error") ?? null;
    if (response.status >= 400 || errorCode) logger.error("request.failed", { requestId, path, status: response.status, errorCode });
    if (response.status >= 500 && isOAuthCallback(request)) return authErrorRedirect(request, "gateway_unavailable", requestId);
    if (errorCode && redirectTarget?.pathname === "/auth/error") {
      redirectTarget.searchParams.set("request_id", requestId);
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("location", redirectTarget.toString());
      return mutableGatewayResponse(response, responseHeaders);
    }
    // Responses returned by Cloudflare service bindings can carry an immutable
    // header guard. React Router merges route response headers while finalizing
    // the document response, so always clone the gateway response before it
    // crosses that boundary—even for successful OAuth redirects.
    return mutableGatewayResponse(response);
  } catch (error) {
    logger.error("request.failed", { requestId, path, ...errorLogContext(error) });
    if (isOAuthCallback(request)) return authErrorRedirect(request, "gateway_unavailable", requestId);
    return Response.json({ error: "authentication_service_unavailable", message: "The authentication service is temporarily unavailable.", requestId }, { status: 502 });
  }
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

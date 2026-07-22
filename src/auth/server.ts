import { redirect } from "react-router";

import { createApplicationAuth } from "./runtime";
import type { Document } from "mongodb";
import { createStorageClient } from "../storage";
import { createLogger, errorLogContext } from "../observability/logger";

interface AuthSession {
  user: { id: string; name: string; email: string; [key: string]: unknown };
  session: { id: string; [key: string]: unknown };
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

export async function handleAuthRequest(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext): Promise<Response> {
  const logger = createLogger(env, "auth");
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const path = new URL(request.url).pathname;
  const runtime = createApplicationAuth(env, request, ctx, requestId);
  try {
    const response = await runtime.handler(request);
    const location = response.headers.get("location");
    const errorCode = location ? new URL(location, request.url).searchParams.get("error") : null;
    if (response.status >= 400 || errorCode) {
      logger.error("request.failed", { requestId, path, status: response.status, errorCode });
      const write = runtime.database.collection<Document & { _id: string }>("auth_error_events").insertOne({
        _id: crypto.randomUUID(), requestId, path, source: "oauth-error-response",
        message: "Authentication request returned an error", ...(errorCode ? { errorCode } : {}), status: response.status,
        createdAt: new Date(), expiresAt: new Date(Date.now() + 14 * 86_400_000),
      });
      await write;
    }
    await runtime.flushErrors();
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: new Headers(response.headers) });
  } catch (error) {
    await runtime.flushErrors();
    logger.error("request.failed", { requestId, path, ...errorLogContext(error) });
    try {
      await runtime.database.collection<Document & { _id: string }>("auth_error_events").insertOne({
        _id: crypto.randomUUID(), requestId, path, source: "auth-handler",
        message: String(errorLogContext(error).errorMessage ?? "Authentication handler failed"),
        ...(error instanceof Error ? { errorName: error.name } : {}),
        createdAt: new Date(), expiresAt: new Date(Date.now() + 14 * 86_400_000),
      });
    } catch (persistenceError) {
      logger.error("error.persistence.failed", errorLogContext(persistenceError));
    }
    if (isOAuthCallback(request)) return authErrorRedirect(request, "authentication_failed", requestId);
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

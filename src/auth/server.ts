import { dash } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins/username";
import { redirect } from "react-router";
import { createStorageClient } from "../storage";

interface AuthEnvironment {
  BETTER_AUTH_API_KEY?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export function authTrustedOrigins(appEnv: CloudflareEnvironment["APP_ENV"], baseUrl: string): string[] {
  if (appEnv === "local") {
    return [
      "http://localhost:*",
      "http://127.0.0.1:*",
      "http://[::1]:*",
    ];
  }
  return [new URL(baseUrl).origin];
}

export function createAuth(env: CloudflareEnvironment, ctx: ExecutionContext) {
  const authEnv = env as unknown as AuthEnvironment;
  const secret = authEnv.BETTER_AUTH_SECRET
    ?? (env.APP_ENV === "local" ? "local-only-secret-change-before-deployment-32-chars" : undefined);
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required outside local development");

  const google = authEnv.GOOGLE_CLIENT_ID && authEnv.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: authEnv.GOOGLE_CLIENT_ID, clientSecret: authEnv.GOOGLE_CLIENT_SECRET } }
    : {};

  return betterAuth({
    appName: "Tableplan",
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: authTrustedOrigins(env.APP_ENV, env.BETTER_AUTH_URL),
    secret,
    database: env.DB,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    socialProviders: google,
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 32 }),
      // Dash ownership validation must exist before onboarding issues an API key.
      dash({ apiKey: authEnv.BETTER_AUTH_API_KEY }),
    ],
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
      backgroundTasks: {
        handler: (promise) => ctx.waitUntil(promise),
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

type AuthSession = Awaited<ReturnType<Auth["api"]["getSession"]>>;

function usesMongoGateway(env: CloudflareEnvironment): boolean {
  return (env as unknown as { STORAGE_BACKEND?: string }).STORAGE_BACKEND === "mongodb-gateway";
}

function gatewayUrl(env: CloudflareEnvironment, requestUrl: string): string {
  const value = (env as unknown as { MONGODB_GATEWAY_URL?: string }).MONGODB_GATEWAY_URL;
  if (!value) throw new Error("MONGODB_GATEWAY_URL is required for gateway-backed authentication");
  const source = new URL(requestUrl); const target = new URL(value);
  target.pathname = source.pathname; target.search = source.search;
  return target.toString();
}

export async function handleAuthRequest(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext): Promise<Response> {
  if (!usesMongoGateway(env)) return createAuth(env, ctx).handler(request);
  const headers = new Headers(request.headers); headers.delete("host");
  headers.set("x-forwarded-origin", new URL(request.url).origin);
  const serviceToken = (env as unknown as { MONGODB_GATEWAY_SERVICE_TOKEN?: string }).MONGODB_GATEWAY_SERVICE_TOKEN;
  if (!serviceToken) throw new Error("MONGODB_GATEWAY_SERVICE_TOKEN is required for gateway-backed authentication");
  headers.set("x-tableplan-service-token", `Bearer ${serviceToken}`);
  return fetch(new Request(gatewayUrl(env, request.url), { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body, redirect: "manual", duplex: request.method === "GET" || request.method === "HEAD" ? undefined : "half" } as RequestInit));
}

export async function getAuthSession(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext): Promise<AuthSession> {
  if (!usesMongoGateway(env)) return createAuth(env, ctx).api.getSession({ headers: request.headers });
  const sessionRequest = new Request(new URL("/api/auth/get-session", request.url), { headers: request.headers });
  const response = await handleAuthRequest(sessionRequest, env, ctx);
  if (!response.ok) return null;
  return await response.json() as AuthSession;
}

export async function ensureUserHousehold(db: D1Database, user: { id: string; name: string }) {
  const preferred = await db.prepare(`SELECT up.default_household_id household_id FROM user_profiles up
    JOIN household_members hm ON hm.household_id=up.default_household_id AND hm.user_id=up.user_id
    WHERE up.user_id=?`).bind(user.id).first<{ household_id: string }>();
  if (preferred?.household_id) return preferred.household_id;

  const membership = await db.prepare(`SELECT household_id FROM household_members WHERE user_id=?
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'adult' THEN 1 ELSE 2 END, created_at LIMIT 1`)
    .bind(user.id).first<{ household_id: string }>();
  if (membership?.household_id) {
    await db.batch([
      db.prepare(`INSERT INTO user_profiles (user_id, default_household_id) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET default_household_id=excluded.default_household_id, updated_at=CURRENT_TIMESTAMP`)
        .bind(user.id, membership.household_id),
      db.prepare("INSERT OR IGNORE INTO household_preferences (household_id) VALUES (?)").bind(membership.household_id),
    ]);
    return membership.household_id;
  }

  const householdId = `household_${user.id}`;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO households (id, name, timezone) VALUES (?, ?, ?)").bind(householdId, `${user.name || "My"} family`, "UTC"),
    db.prepare("INSERT OR IGNORE INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')").bind(householdId, user.id),
    db.prepare(`INSERT INTO user_profiles (user_id, default_household_id) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET default_household_id=excluded.default_household_id, updated_at=CURRENT_TIMESTAMP`).bind(user.id, householdId),
    db.prepare("INSERT OR IGNORE INTO household_preferences (household_id) VALUES (?)").bind(householdId),
  ]);
  return householdId;
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

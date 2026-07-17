import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins/username";
import { redirect } from "react-router";

interface AuthEnvironment extends CloudflareEnvironment {
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export function authTrustedOrigins(appEnv: CloudflareEnvironment["APP_ENV"], baseUrl: string): string[] {
  if (appEnv === "local") return ["http://localhost:5173", "http://127.0.0.1:5173"];
  return [new URL(baseUrl).origin];
}

export function createAuth(env: CloudflareEnvironment, ctx: ExecutionContext) {
  const authEnv = env as AuthEnvironment;
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
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 32 })],
    advanced: {
      backgroundTasks: {
        handler: (promise) => ctx.waitUntil(promise),
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export async function ensureUserHousehold(db: D1Database, user: { id: string; name: string }) {
  const householdId = `household_${user.id}`;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO households (id, name, timezone) VALUES (?, ?, ?)").bind(householdId, `${user.name || "My"} family`, "UTC"),
    db.prepare("INSERT OR IGNORE INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')").bind(householdId, user.id),
    db.prepare("INSERT OR IGNORE INTO user_profiles (user_id, default_household_id) VALUES (?, ?)").bind(user.id, householdId),
    db.prepare("INSERT OR IGNORE INTO household_preferences (household_id) VALUES (?)").bind(householdId),
  ]);
  return householdId;
}

export async function getRequestSession(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext) {
  const auth = createAuth(env, ctx);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const householdId = await ensureUserHousehold(env.DB, session.user);
  return { ...session, householdId };
}

export async function requireRequestSession(request: Request, env: CloudflareEnvironment, ctx: ExecutionContext) {
  const session = await getRequestSession(request, env, ctx);
  if (!session) throw redirect("/sign-in");
  return session;
}

import { dash } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { username } from "better-auth/plugins/username";
import type { MongoClient, Db } from "mongodb";

import type { GatewayConfig } from "./config";

export type BetterAuthLogLevel = "debug" | "info" | "warn" | "error";
export type BetterAuthLogReporter = (level: BetterAuthLogLevel, message: unknown, ...args: unknown[]) => void;

export function createGatewayAuth(
  config: GatewayConfig,
  database: Db,
  client: MongoClient,
  runInBackground: (promise: Promise<unknown>) => void = (promise) => { void promise; },
  reportError: (error: unknown) => void = () => undefined,
  reportLog: BetterAuthLogReporter = () => undefined,
) {
  const google = config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET ? { google: { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET } } : {};
  return betterAuth({
    appName: "Tableplan",
    baseURL: config.BETTER_AUTH_URL,
    trustedOrigins: config.APP_ENV === "local" ? ["http://localhost:*", "http://127.0.0.1:*", "http://[::1]:*"] : [new URL(config.BETTER_AUTH_URL).origin],
    secret: config.BETTER_AUTH_SECRET,
    // Better Auth's multi-document OAuth transaction is not reliable over the
    // MongoDB driver's Workers TCP transport: an account insert can be replayed
    // inside the transaction and leave the session in NoSuchTransaction state.
    // Individual writes remain retryable and the synced unique indexes enforce
    // user-email and provider-account identity.
    database: mongodbAdapter(database, { client, usePlural: true, transaction: false }),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    socialProviders: google,
    onAPIError: {
      errorURL: new URL("/auth/error", config.BETTER_AUTH_URL).toString(),
      onError: reportError,
    },
    logger: {
      level: "debug",
      disableColors: true,
      log: reportLog as (level: BetterAuthLogLevel, message: string, ...args: unknown[]) => void,
    },
    // Dash ownership validation must exist before onboarding issues an API key.
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 32 }),
      dash({ apiKey: config.BETTER_AUTH_API_KEY, apiTimeout: config.BETTER_AUTH_API_TIMEOUT_MS }),
    ],
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
      database: { generateId: () => crypto.randomUUID() },
      backgroundTasks: { handler: runInBackground },
    },
  });
}

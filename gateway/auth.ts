import { dash } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { username } from "better-auth/plugins/username";
import type { MongoClient, Db } from "mongodb";

import type { GatewayConfig } from "./config";

export function createGatewayAuth(config: GatewayConfig, database: Db, client: MongoClient) {
  const google = config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET ? { google: { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET } } : {};
  return betterAuth({
    appName: "Tableplan",
    baseURL: config.BETTER_AUTH_URL,
    trustedOrigins: config.APP_ENV === "local" ? ["http://localhost:*", "http://127.0.0.1:*", "http://[::1]:*"] : [new URL(config.BETTER_AUTH_URL).origin],
    secret: config.BETTER_AUTH_SECRET,
    database: mongodbAdapter(database, { client, usePlural: true }),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    socialProviders: google,
    // Dash ownership validation must exist before onboarding issues an API key.
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 32 }), dash({ apiKey: config.BETTER_AUTH_API_KEY })],
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
      database: { generateId: () => crypto.randomUUID() },
      backgroundTasks: { handler: (promise) => { void promise; } },
    },
  });
}

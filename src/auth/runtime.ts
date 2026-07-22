import { dash } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { username } from "better-auth/plugins/username";
import type { Db } from "mongodb";

import { createMongoAuthErrorRecorder, type AuthErrorEvent } from "../storage/mongodb/auth-error-events";
import { createLogger, errorLogContext } from "../observability/logger";
import { createMongoGatewayClient, createMongoGatewayDatabase, type MongoGatewayClientEnvironment } from "../storage/mongo-gateway";
import { createAuthSessionStorage } from "./session-storage";
import type { AuthSessionStoreDO } from "../../workers/auth-session-store";

type AuthEnvironment = CloudflareEnvironment & MongoGatewayClientEnvironment & {
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_API_KEY?: string;
  BETTER_AUTH_API_TIMEOUT_MS?: string | number;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_ENV?: string;
  AUTH_SESSION_STORE: DurableObjectNamespace<AuthSessionStoreDO>;
};

function safeLogValue(value: unknown): unknown {
  if (value instanceof Error) return errorLogContext(value);
  if (typeof value === "string") return errorLogContext(value).errorMessage;
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      ["name", "message", "code", "codeName", "status", "statusText"]
        .filter((key) => typeof record[key] === "string" || typeof record[key] === "number" || typeof record[key] === "boolean")
        .map((key) => [key, typeof record[key] === "string" ? errorLogContext(record[key]).errorMessage : record[key]]),
    );
  }
  return { type: typeof value };
}

function errorEvent(message: unknown, args: unknown[]): Pick<AuthErrorEvent, "message" | "details" | "errorCode" | "errorName" | "errorCodeName" | "status"> {
  const values = [message, ...args];
  const error = values.find((value): value is Error & { code?: unknown; codeName?: unknown; status?: unknown } => value instanceof Error);
  const safeMessage = safeLogValue(message);
  return {
    message: typeof safeMessage === "string" ? safeMessage : error ? String(errorLogContext(error).errorMessage) : "Better Auth reported an error",
    ...(args.length ? { details: args.map(safeLogValue) } : {}),
    ...(error ? {
      errorName: error.name,
      ...(typeof error.code === "string" || typeof error.code === "number" ? { errorCode: error.code } : {}),
      ...(typeof error.codeName === "string" ? { errorCodeName: error.codeName } : {}),
      ...(typeof error.status === "string" || typeof error.status === "number" ? { status: error.status } : {}),
    } : {}),
  };
}

function required(env: AuthEnvironment, name: "BETTER_AUTH_URL" | "BETTER_AUTH_SECRET"): string {
  const value = env[name];
  if (!value || (name === "BETTER_AUTH_SECRET" && value.length < 32)) throw new Error(`${name} is required${name === "BETTER_AUTH_SECRET" ? " and must contain at least 32 characters" : ""}`);
  return value;
}

export function createApplicationAuth(
  env: AuthEnvironment,
  request: Request,
  ctx: ExecutionContext,
  requestId: string,
): { handler(request: Request): Promise<Response>; flushErrors(): Promise<void>; database: Db } {
  const baseURL = required(env, "BETTER_AUTH_URL");
  const secret = required(env, "BETTER_AUTH_SECRET");
  const database = createMongoGatewayDatabase(createMongoGatewayClient(env));
  const logger = createLogger(env, "auth");
  const writes = new Set<Promise<void>>();
  const recorder = createMongoAuthErrorRecorder(database, (promise) => ctx.waitUntil(promise), (error) => {
    logger.error("error.persistence.failed", errorLogContext(error));
  });
  const persist = (event: Omit<AuthErrorEvent, "requestId" | "path">) => {
    const write = recorder({ requestId, path: new URL(request.url).pathname, ...event });
    writes.add(write);
    void write.finally(() => writes.delete(write));
  };
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
    : {};
  const plugins = [username({ minUsernameLength: 3, maxUsernameLength: 32 })];
  if (env.BETTER_AUTH_API_KEY) {
    plugins.push(dash({
      apiKey: env.BETTER_AUTH_API_KEY,
      apiTimeout: Number(env.BETTER_AUTH_API_TIMEOUT_MS ?? 10_000),
    }) as never);
  }
  const auth = betterAuth({
    appName: "Tableplan",
    baseURL,
    trustedOrigins: env.APP_ENV === "local" ? ["http://localhost:*", "http://127.0.0.1:*", "http://[::1]:*"] : [new URL(baseURL).origin],
    secret,
    database: mongodbAdapter(database, { usePlural: true, transaction: false }),
    secondaryStorage: createAuthSessionStorage(env.AUTH_SESSION_STORE),
    session: { storeSessionInDatabase: false },
    // OAuth state and other single-use verification records stay in MongoDB.
    // They must be immediately consistent across the provider redirect.
    verification: { storeInDatabase: true },
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    socialProviders: google,
    onAPIError: {
      errorURL: new URL("/auth/error", baseURL).toString(),
      onError(error) {
        const context = errorLogContext(error);
        logger.error("request.failed", { requestId, path: new URL(request.url).pathname, ...context });
        persist({ source: "api-error", message: String(context.errorMessage ?? "Better Auth API error"), ...(error instanceof Error ? { errorName: error.name } : {}) });
      },
    },
    logger: {
      level: "debug",
      disableColors: true,
      log(level, message, ...args) {
        const details = args.map(safeLogValue);
        if (level === "error") {
          logger.error("better-auth", { requestId, message: safeLogValue(message), details });
          persist({ source: "better-auth", ...errorEvent(message, args) });
        } else if (level === "warn") logger.info("better-auth.warning", { requestId, message: safeLogValue(message), details });
        else logger.debug("better-auth", { requestId, betterAuthLevel: level, message: safeLogValue(message), details });
      },
    },
    plugins,
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
      database: { generateId: () => crypto.randomUUID() },
      backgroundTasks: { handler: (promise) => ctx.waitUntil(promise) },
    },
  });

  return {
    handler: (authRequest) => auth.handler(authRequest),
    async flushErrors() {
      while (writes.size) await Promise.all([...writes]);
    },
    database,
  };
}

import { AsyncLocalStorage } from "node:async_hooks";

import type { GatewayConfig } from "./config";
import { createGatewayHandler } from "./app";
import { createMongoAuthErrorRecorder, type AuthErrorEvent } from "./auth-error-events";
import { createMongoApiKeyStore } from "./api-keys";
import { createGatewayAuth, type BetterAuthLogLevel } from "./auth";
import { createMongoEmailStore } from "./email";
import { createMongoHouseholdStore } from "./households";
import { createMongoIngestionStore } from "./ingestions";
import { createMongoRuntime } from "./mongo";
import { createMongoPlanStore } from "./plans";
import { createMongoRecipeStore } from "./recipes";
import { createMongoShareStore } from "./shares";
import { createMongoShoppingStore } from "./shopping";
import { createMongoTenantStore } from "./tenant";
import { createLogger, errorLogContext } from "../src/observability/logger";

interface AuthRequestContext {
  requestId: string;
  path: string;
  errorWrites: Set<Promise<void>>;
}

function betterAuthLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    const coded = value as Error & { code?: unknown; codeName?: unknown; status?: unknown };
    return {
      ...errorLogContext(value),
      ...(typeof coded.code === "string" || typeof coded.code === "number" ? { errorCode: coded.code } : {}),
      ...(typeof coded.codeName === "string" ? { errorCodeName: coded.codeName } : {}),
      ...(typeof coded.status === "string" || typeof coded.status === "number" ? { status: coded.status } : {}),
    };
  }
  if (typeof value === "string") return errorLogContext(value).errorMessage;
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const safe: Record<string, unknown> = {};
    for (const key of ["name", "message", "code", "codeName", "status", "statusText"]) {
      const field = record[key];
      if (typeof field === "string") safe[key] = errorLogContext(field).errorMessage;
      else if (typeof field === "number" || typeof field === "boolean") safe[key] = field;
    }
    return Object.keys(safe).length ? safe : { type: value.constructor?.name ?? "Object" };
  }
  return { type: typeof value };
}

function betterAuthErrorEvent(message: unknown, args: unknown[]): Pick<AuthErrorEvent, "message" | "details" | "errorCode" | "errorName" | "errorCodeName" | "status"> {
  const values = [message, ...args];
  const error = values.find((value): value is Error & { code?: unknown; codeName?: unknown; status?: unknown } => value instanceof Error);
  const safeMessage = betterAuthLogValue(message);
  return {
    message: typeof safeMessage === "string" ? safeMessage : error ? String(errorLogContext(error).errorMessage) : "Better Auth reported an error",
    ...(args.length ? { details: args.map(betterAuthLogValue) } : {}),
    ...(error ? {
      errorName: error.name,
      ...(typeof error.code === "string" || typeof error.code === "number" ? { errorCode: error.code } : {}),
      ...(typeof error.codeName === "string" ? { errorCodeName: error.codeName } : {}),
      ...(typeof error.status === "string" || typeof error.status === "number" ? { status: error.status } : {}),
    } : {}),
  };
}

function writeBetterAuthLog(logger: ReturnType<typeof createLogger>, level: BetterAuthLogLevel, message: unknown, args: unknown[]): void {
  const context = {
    message: betterAuthLogValue(message),
    ...(args.length ? { details: args.map(betterAuthLogValue) } : {}),
  };
  if (level === "error") logger.error("better-auth", context);
  else if (level === "warn") logger.info("better-auth.warning", context);
  else logger.debug("better-auth", { betterAuthLevel: level, ...context });
}

export function createGatewayRuntime(config: GatewayConfig, options: { waitUntil?: (promise: Promise<unknown>) => void } = {}) {
  const logger = createLogger(config, "mongodb-gateway");
  const mongo = createMongoRuntime(config);
  const requestContext = new AsyncLocalStorage<AuthRequestContext>();
  const schedule = options.waitUntil ?? ((promise: Promise<unknown>) => { void promise; });
  const recordAuthError = createMongoAuthErrorRecorder(mongo.database, schedule, (error) => {
    logger.error("auth.error.persistence.failed", errorLogContext(error));
  });
  const persistAuthError = (event: AuthErrorEvent): void => {
    const write = recordAuthError(event);
    requestContext.getStore()?.errorWrites.add(write);
  };
  const flushAuthErrors = async (context: AuthRequestContext): Promise<void> => {
    // Error hooks and the Better Auth logger are synchronous, but their MongoDB
    // inserts are not. Drain every write they queued before completing the
    // request so OAuth redirects cannot outrun their diagnostic record.
    while (context.errorWrites.size) {
      const writes = [...context.errorWrites];
      context.errorWrites.clear();
      await Promise.all(writes);
    }
  };
  const recipes = createMongoRecipeStore(mongo.database);
  const plans = createMongoPlanStore(mongo.database, recipes, (operation) => mongo.withTransaction(operation));
  const shopping = createMongoShoppingStore(mongo.database, plans, recipes);
  const shares = createMongoShareStore(mongo.database, shopping);
  const auth = createGatewayAuth(
    config,
    mongo.database,
    mongo.client,
    options.waitUntil,
    (error) => {
      const context = requestContext.getStore() ?? { requestId: crypto.randomUUID(), path: "unknown" };
      const errorContext = errorLogContext(error);
      logger.error("auth.failed", { requestId: context.requestId, path: context.path, ...errorContext });
      persistAuthError({ requestId: context.requestId, path: context.path, source: "api-error", message: String(errorContext.errorMessage ?? "Better Auth API error"), ...(error instanceof Error ? { errorName: error.name } : {}) });
    },
    (level, message, ...args) => {
      writeBetterAuthLog(logger, level, message, args);
      if (level === "error") {
        const context = requestContext.getStore() ?? { requestId: crypto.randomUUID(), path: "unknown" };
        persistAuthError({ requestId: context.requestId, path: context.path, source: "better-auth", ...betterAuthErrorEvent(message, args) });
      }
    },
  );
  const handler = createGatewayHandler({
    serviceToken: config.MONGODB_GATEWAY_SERVICE_TOKEN,
    maxBodyBytes: config.GATEWAY_MAX_BODY_BYTES,
    maxInFlight: config.GATEWAY_MAX_IN_FLIGHT,
    ping: () => mongo.ping(),
    recipes,
    tenant: createMongoTenantStore(mongo.database, recipes, (operation) => mongo.withTransaction(operation)),
    plans,
    shopping,
    shares,
    apiKeys: createMongoApiKeyStore(mongo.database),
    ingestions: createMongoIngestionStore(mongo.database, (operation) => mongo.withTransaction(operation)),
    authHandler: async (request) => {
      const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
      const path = new URL(request.url).pathname;
      const context: AuthRequestContext = { requestId, path, errorWrites: new Set() };
      return requestContext.run(context, async () => {
        try {
          const response = await auth.handler(request);
          const location = response.headers.get("location");
          const errorCode = location ? new URL(location, request.url).searchParams.get("error") : null;
          if (response.status >= 400 || errorCode) {
            logger.error("auth.request.failed", { requestId, path, status: response.status, errorCode });
            persistAuthError({ requestId, path, source: "oauth-error-response", message: "Authentication request returned an error", ...(errorCode ? { errorCode } : {}), status: response.status });
          }
          await flushAuthErrors(context);
          return response;
        } catch (error) {
          const errorContext = errorLogContext(error);
          logger.error("auth.request.failed", { requestId, path, ...errorContext });
          persistAuthError({ requestId, path, source: "auth-handler", message: String(errorContext.errorMessage ?? "Authentication handler failed"), ...(error instanceof Error ? { errorName: error.name } : {}) });
          await flushAuthErrors(context);
          throw error;
        }
      });
    },
    households: createMongoHouseholdStore(mongo.database, (operation) => mongo.withTransaction(operation)),
    email: createMongoEmailStore(mongo.database),
    log: (event) => {
      const { event: eventName, ...context } = event;
      logger.info(typeof eventName === "string" ? eventName : "event", context);
    },
  });

  return { handler, logger, mongo };
}

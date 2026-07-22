import { DurableObject } from "cloudflare:workers";

import { loadGatewayConfig } from "../gateway/config";
import { createGatewayRuntime } from "../gateway/runtime";
import { errorLogContext, type Logger } from "../src/observability/logger";
import type { MongoRuntime } from "../gateway/mongo";

type LocationHint = "enam" | "wnam" | "weur" | "eeur" | "apac";

export interface MongoGatewayEnvironment extends Record<string, unknown> {
  MONGO_DO: DurableObjectNamespace<MongoGatewayDO>;
  MONGO_LOCATION_HINT?: string;
  MONGODB_URI?: string;
}

const locationHints = new Set<LocationHint>(["enam", "wnam", "weur", "eeur", "apac"]);

function locationHint(value: string | undefined): LocationHint {
  return value && locationHints.has(value as LocationHint) ? value as LocationHint : "weur";
}

function configurationError(env: MongoGatewayEnvironment): string | null {
  if (!env.MONGODB_URI || typeof env.MONGODB_URI !== "string") return "MONGODB_URI is not configured";
  if (!env.MONGODB_GATEWAY_SERVICE_TOKEN || typeof env.MONGODB_GATEWAY_SERVICE_TOKEN !== "string") return "MONGODB_GATEWAY_SERVICE_TOKEN is not configured";
  return null;
}

export class MongoGatewayDO extends DurableObject<MongoGatewayEnvironment> {
  private readonly handler: (request: Request) => Promise<Response>;
  private readonly logger: Logger;
  private readonly mongo: MongoRuntime;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(state: DurableObjectState, env: MongoGatewayEnvironment) {
    super(state, env);
    const runtime = createGatewayRuntime(loadGatewayConfig(env));
    this.handler = runtime.handler;
    this.logger = runtime.logger;
    this.mongo = runtime.mongo;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (!this.connectPromise) {
      this.connectPromise = this.mongo.connect().then(() => {
        this.connected = true;
        this.logger.info("connected", { database: this.mongo.database.databaseName, runtime: "durable-object" });
      });
    }
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async fetch(request: Request): Promise<Response> {
    try {
      await this.ensureConnected();
      return await this.handler(request);
    } catch (error) {
      this.logger.error("request.failed", errorLogContext(error));
      return Response.json({ error: "gateway_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
    }
  }
}

export default {
  async fetch(request: Request, env: MongoGatewayEnvironment): Promise<Response> {
    const error = configurationError(env);
    if (error) return Response.json({ error }, { status: 503, headers: { "cache-control": "no-store" } });

    const id = env.MONGO_DO.idFromName("pool-0");
    const stub = env.MONGO_DO.get(id, { locationHint: locationHint(env.MONGO_LOCATION_HINT) });
    return stub.fetch(request);
  },
} satisfies ExportedHandler<MongoGatewayEnvironment>;

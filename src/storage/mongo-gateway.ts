import type { Db, Document } from "mongodb";

import {
  MONGO_GATEWAY_PROTOCOL_VERSION,
  decodeMongoValue,
  encodeMongoValue,
  type MongoGatewayOperation,
  type MongoGatewayRequest,
  type MongoGatewayResponse,
} from "./mongo-protocol";
import { resolveMongoGatewayTransport, type MongoGatewayEnvironment } from "./gateway-transport";

export type MongoGatewayClientEnvironment = MongoGatewayEnvironment & {
  MONGODB_GATEWAY_SERVICE_TOKEN?: string;
};

export class MongoGatewayError extends Error {
  readonly code?: string | number;
  readonly codeName?: string;
  readonly retryable: boolean;

  constructor(error: { name: string; message: string; code?: string | number; codeName?: string; retryable: boolean }) {
    super(error.message);
    this.name = error.name;
    this.code = error.code;
    this.codeName = error.codeName;
    this.retryable = error.retryable;
  }
}

export class MongoGatewayClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      serviceToken: string;
      fetcher: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async execute<T>(operation: MongoGatewayOperation, collection?: string, args?: Record<string, unknown>): Promise<T> {
    const requestId = crypto.randomUUID();
    const timeoutMs = this.options.timeoutMs ?? 15_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const payload: MongoGatewayRequest = {
      version: MONGO_GATEWAY_PROTOCOL_VERSION,
      requestId,
      deadlineAt: Date.now() + timeoutMs,
      operation,
      ...(collection ? { collection } : {}),
      ...(args ? { args: encodeMongoValue(args) as Record<string, unknown> } : {}),
    };
    try {
      const response = await this.options.fetcher(new Request(new URL("/v1/mongodb", this.options.baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.serviceToken}`,
          "content-type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }));
      let body: unknown = null;
      try { body = await response.json(); } catch { /* handled below */ }
      if (isGatewayFailure(body)) throw new MongoGatewayError(body.error);
      if (!response.ok || !isGatewaySuccess(body)) {
        const gatewayCode = responseErrorCode(body);
        throw new MongoGatewayError({
          name: "MongoGatewayError",
          message: `MongoDB gateway returned HTTP ${response.status}${gatewayCode ? `: ${gatewayCode}` : ""}`,
          retryable: response.status >= 500 || response.status === 408 || response.status === 429,
        });
      }
      return decodeMongoValue(body.result) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  ping(): Promise<{ ok: boolean }> { return this.execute("ping"); }
}

function isGatewayFailure(value: unknown): value is Extract<MongoGatewayResponse, { ok: false }> {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  if (response.ok !== false || !response.error || typeof response.error !== "object") return false;
  const error = response.error as Record<string, unknown>;
  return typeof error.name === "string" && typeof error.message === "string" && typeof error.retryable === "boolean";
}

function isGatewaySuccess(value: unknown): value is Extract<MongoGatewayResponse, { ok: true }> {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).ok === true);
}

function responseErrorCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const response = value as Record<string, unknown>;
  if (typeof response.error === "string" && response.error) return response.error;
  if (typeof response.message === "string" && response.message) return response.message;
  return null;
}

export function createMongoGatewayClient(env: MongoGatewayClientEnvironment): MongoGatewayClient {
  if (!env.MONGODB_GATEWAY_SERVICE_TOKEN) throw new Error("MONGODB_GATEWAY_SERVICE_TOKEN is required");
  const transport = resolveMongoGatewayTransport(env);
  return new MongoGatewayClient({
    baseUrl: transport.baseUrl,
    serviceToken: env.MONGODB_GATEWAY_SERVICE_TOKEN,
    fetcher: transport.fetcher,
  });
}

function cleanOptions(options: unknown): Record<string, unknown> | undefined {
  if (!options || typeof options !== "object") return undefined;
  const { session: _session, ...rest } = options as Record<string, unknown>;
  return rest;
}

class RemoteCursor<T extends Document> {
  private options: Record<string, unknown>;

  constructor(
    private readonly client: MongoGatewayClient,
    private readonly collection: string,
    private readonly operation: "find" | "aggregate",
    private readonly input: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) {
    this.options = { ...(options ?? {}) };
  }

  sort(value: unknown): this { this.options.sort = value; return this; }
  skip(value: number): this { this.options.skip = value; return this; }
  limit(value: number): this { this.options.limit = value; return this; }
  project(value: unknown): this { this.options.projection = value; return this; }

  toArray(): Promise<T[]> {
    return this.client.execute<T[]>(this.operation, this.collection, { ...this.input, options: this.options });
  }

  async next(): Promise<T | null> {
    const documents = await this.limit(1).toArray();
    return documents[0] ?? null;
  }
}

function remoteCollection<T extends Document>(client: MongoGatewayClient, name: string) {
  return {
    collectionName: name,
    findOne: (filter: unknown = {}, options?: unknown) => client.execute<T | null>("findOne", name, { filter, options: cleanOptions(options) }),
    find: (filter: unknown = {}, options?: unknown) => new RemoteCursor<T>(client, name, "find", { filter }, cleanOptions(options)),
    aggregate: <R extends Document = T>(pipeline: unknown[] = [], options?: unknown) => new RemoteCursor<R>(client, name, "aggregate", { pipeline }, cleanOptions(options)),
    countDocuments: (filter: unknown = {}, options?: unknown) => client.execute<number>("countDocuments", name, { filter, options: cleanOptions(options) }),
    distinct: (field: string, filter: unknown = {}, options?: unknown) => client.execute<unknown[]>("distinct", name, { field, filter, options: cleanOptions(options) }),
    insertOne: async (document: unknown, options?: unknown) => ({
      acknowledged: true,
      insertedId: (await client.execute<{ insertedId: unknown }>("insertOne", name, { document, options: cleanOptions(options) })).insertedId,
    }),
    insertMany: async (documents: unknown[], options?: unknown) => {
      const result = await client.execute<{ insertedIds: Record<string, unknown>; insertedCount: number }>("insertMany", name, { documents, options: cleanOptions(options) });
      return { acknowledged: true, ...result };
    },
    updateOne: (filter: unknown, update: unknown, options?: unknown) => client.execute("updateOne", name, { filter, update, options: cleanOptions(options) }),
    updateMany: (filter: unknown, update: unknown, options?: unknown) => client.execute("updateMany", name, { filter, update, options: cleanOptions(options) }),
    replaceOne: (filter: unknown, replacement: unknown, options?: unknown) => client.execute("replaceOne", name, { filter, replacement, options: cleanOptions(options) }),
    findOneAndUpdate: (filter: unknown, update: unknown, options?: unknown) => client.execute<T | null>("findOneAndUpdate", name, { filter, update, options: cleanOptions(options) }),
    findOneAndDelete: (filter: unknown, options?: unknown) => client.execute<T | null>("findOneAndDelete", name, { filter, options: cleanOptions(options) }),
    findOneAndReplace: (filter: unknown, replacement: unknown, options?: unknown) => client.execute<T | null>("findOneAndReplace", name, { filter, replacement, options: cleanOptions(options) }),
    deleteOne: (filter: unknown, options?: unknown) => client.execute("deleteOne", name, { filter, options: cleanOptions(options) }),
    deleteMany: (filter: unknown, options?: unknown) => client.execute("deleteMany", name, { filter, options: cleanOptions(options) }),
    bulkWrite: (operations: unknown[], options?: unknown) => client.execute("bulkWrite", name, { operations, options: cleanOptions(options) }),
  };
}

/**
 * A deliberately small Db-compatible facade. Domain stores and Better Auth run
 * in the application Worker; every collection method is transported to the
 * operations-only gateway.
 */
export function createMongoGatewayDatabase(client: MongoGatewayClient, databaseName = "gateway-managed"): Db {
  const database = {
    databaseName,
    collection<T extends Document = Document>(name: string) { return remoteCollection<T>(client, name); },
    command(command: Record<string, unknown>) {
      if (command.ping === 1) return client.ping();
      throw new Error("Only the ping database command is supported by the MongoDB gateway facade");
    },
  };
  return database as unknown as Db;
}

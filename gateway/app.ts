import { createHash, timingSafeEqual } from "node:crypto";
import { ObjectId, type Db, type Document } from "mongodb";

import {
  MONGO_GATEWAY_OPERATIONS,
  MONGO_GATEWAY_PROTOCOL_VERSION,
  decodeMongoValue,
  encodeMongoValue,
  type MongoGatewayOperation,
  type MongoGatewayRequest,
  type MongoGatewayResponse,
} from "../src/storage/mongo-protocol";

export interface GatewayDependencies {
  serviceToken: string;
  maxBodyBytes: number;
  maxInFlight?: number;
  database: Db;
  ping(): Promise<void>;
  now?: () => number;
  log?: (event: Record<string, unknown>) => void;
}

const operations = new Set<string>(MONGO_GATEWAY_OPERATIONS);
const collectionName = /^[A-Za-z][A-Za-z0-9_.-]{0,119}$/;

function authenticated(header: string | null, expectedToken: string): boolean {
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const expectedHash = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(suppliedHash, expectedHash) && supplied.length === expectedToken.length;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

async function readBody(request: Request, maxBodyBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBodyBytes) throw new Error("request_too_large");
  if (!request.body) throw new Error("invalid_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      throw new Error("request_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new Error("invalid_json"); }
}

function parseRequest(value: unknown): MongoGatewayRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Partial<MongoGatewayRequest>;
  if (request.version !== MONGO_GATEWAY_PROTOCOL_VERSION) return null;
  if (typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 128) return null;
  if (typeof request.operation !== "string" || !operations.has(request.operation)) return null;
  if (request.operation !== "ping" && (typeof request.collection !== "string" || !collectionName.test(request.collection))) return null;
  if (request.deadlineAt !== undefined && (!Number.isSafeInteger(request.deadlineAt) || request.deadlineAt <= 0)) return null;
  if (request.args !== undefined && (!request.args || typeof request.args !== "object" || Array.isArray(request.args))) return null;
  return request as MongoGatewayRequest;
}

function success(requestId: string, result: unknown): MongoGatewayResponse {
  return { version: MONGO_GATEWAY_PROTOCOL_VERSION, requestId, ok: true, result: encodeMongoValue(result) };
}

function failure(requestId: string, error: unknown): MongoGatewayResponse {
  const value = error as Error & { code?: unknown; codeName?: unknown; hasErrorLabel?: (label: string) => boolean };
  const code = typeof value?.code === "string" || typeof value?.code === "number" ? value.code : undefined;
  const retryable = Boolean(
    value?.hasErrorLabel?.("RetryableWriteError")
    || value?.hasErrorLabel?.("TransientTransactionError")
    || value?.name === "MongoNetworkError"
    || value?.name === "MongoServerSelectionError",
  );
  return {
    version: MONGO_GATEWAY_PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: {
      name: value?.name || "MongoGatewayError",
      message: value?.message || "MongoDB operation failed",
      ...(code !== undefined ? { code } : {}),
      ...(typeof value?.codeName === "string" ? { codeName: value.codeName } : {}),
      retryable,
    },
  };
}

function args(request: MongoGatewayRequest): Record<string, unknown> {
  return decodeMongoValue(request.args ?? {}, (hex) => new ObjectId(hex)) as Record<string, unknown>;
}

async function execute(database: Db, request: MongoGatewayRequest): Promise<unknown> {
  if (request.operation === "ping") {
    const result = await database.command({ ping: 1 });
    return { ok: result.ok === 1 };
  }
  const input = args(request);
  const collection = database.collection(request.collection as string);
  const filter = (input.filter ?? {}) as Document;
  const options = (input.options ?? {}) as Document;

  switch (request.operation as MongoGatewayOperation) {
    case "findOne":
      return collection.findOne(filter, options);
    case "find":
      return collection.find(filter, { ...options, limit: Math.min(Number(options.limit ?? 10_000), 10_000) }).toArray();
    case "aggregate": {
      if (!Array.isArray(input.pipeline)) throw new TypeError("pipeline must be an array");
      return collection.aggregate(input.pipeline as Document[], options).toArray();
    }
    case "countDocuments":
      return collection.countDocuments(filter, options);
    case "distinct":
      if (typeof input.field !== "string" || !input.field) throw new TypeError("field is required");
      return collection.distinct(input.field, filter, options);
    case "insert":
    case "insertOne": {
      if (!input.document || typeof input.document !== "object") throw new TypeError("document is required");
      const result = await collection.insertOne(input.document as Document, options);
      return { insertedId: result.insertedId };
    }
    case "batchInsert":
    case "insertMany": {
      if (!Array.isArray(input.documents) || !input.documents.length || input.documents.length > 1_000) throw new TypeError("documents must contain 1-1000 items");
      const result = await collection.insertMany(input.documents as Document[], options);
      return { insertedIds: result.insertedIds, insertedCount: result.insertedCount };
    }
    case "update":
    case "updateOne": {
      const result = await collection.updateOne(filter, input.update as Document, options);
      return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount, upsertedCount: result.upsertedCount, upsertedId: result.upsertedId };
    }
    case "batchUpdate":
    case "updateMany": {
      const result = await collection.updateMany(filter, input.update as Document, options);
      return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount, upsertedCount: result.upsertedCount, upsertedId: result.upsertedId };
    }
    case "replaceOne": {
      const result = await collection.replaceOne(filter, input.replacement as Document, options);
      return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount, upsertedCount: result.upsertedCount, upsertedId: result.upsertedId };
    }
    case "findOneAndUpdate":
      return collection.findOneAndUpdate(filter, input.update as Document, options);
    case "findOneAndDelete":
      return collection.findOneAndDelete(filter, options);
    case "findOneAndReplace":
      return collection.findOneAndReplace(filter, input.replacement as Document, options);
    case "findAndModify":
      if (input.remove === true) return collection.findOneAndDelete(filter, options);
      if (input.replacement) return collection.findOneAndReplace(filter, input.replacement as Document, options);
      return collection.findOneAndUpdate(filter, input.update as Document, options);
    case "delete":
    case "deleteOne": {
      const result = await collection.deleteOne(filter, options);
      return { deletedCount: result.deletedCount };
    }
    case "batchDelete":
    case "deleteMany": {
      const result = await collection.deleteMany(filter, options);
      return { deletedCount: result.deletedCount };
    }
    case "bulkWrite": {
      if (!Array.isArray(input.operations) || !input.operations.length || input.operations.length > 1_000) throw new TypeError("operations must contain 1-1000 items");
      const result = await collection.bulkWrite(input.operations as never[], options);
      return {
        insertedCount: result.insertedCount,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        deletedCount: result.deletedCount,
        upsertedCount: result.upsertedCount,
        upsertedIds: result.upsertedIds,
        insertedIds: result.insertedIds,
      };
    }
    default:
      throw new TypeError(`Unsupported MongoDB operation: ${request.operation}`);
  }
}

export function createGatewayHandler(dependencies: GatewayDependencies) {
  const now = dependencies.now ?? (() => performance.now());
  const log = dependencies.log ?? ((event: Record<string, unknown>) => console.info(JSON.stringify(event)));
  let inFlight = 0;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") return json({ status: "ok" });
    if (request.method === "GET" && url.pathname === "/readyz") {
      try { await dependencies.ping(); return json({ status: "ok" }); }
      catch { return json({ status: "unavailable" }, 503); }
    }
    if (url.pathname !== "/v1/mongodb") return new Response(null, { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    if (!authenticated(request.headers.get("authorization"), dependencies.serviceToken)) return json({ error: "unauthorized" }, 401);
    if (inFlight >= (dependencies.maxInFlight ?? 100)) return json({ error: "gateway_busy" }, 429);

    let parsed: MongoGatewayRequest | null;
    try { parsed = parseRequest(await readBody(request, dependencies.maxBodyBytes)); }
    catch (error) {
      const code = error instanceof Error ? error.message : "invalid_json";
      return json({ error: code }, code === "request_too_large" ? 413 : 400);
    }
    if (!parsed) return json({ error: "invalid_request" }, 400);
    if (parsed.deadlineAt && parsed.deadlineAt < Date.now()) return json({ error: "deadline_exceeded" }, 408);

    const startedAt = now();
    inFlight += 1;
    try {
      const result = await execute(dependencies.database, parsed);
      log({ event: "operation.succeeded", requestId: parsed.requestId, operation: parsed.operation, collection: parsed.collection, durationMs: now() - startedAt });
      return json(success(parsed.requestId, result));
    } catch (error) {
      const response = failure(parsed.requestId, error);
      log({ event: "operation.failed", requestId: parsed.requestId, operation: parsed.operation, collection: parsed.collection, durationMs: now() - startedAt, errorName: response.ok ? undefined : response.error.name, errorCode: response.ok ? undefined : response.error.code });
      return json(response, 500);
    } finally {
      inFlight -= 1;
    }
  };
}

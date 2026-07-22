export const MONGO_GATEWAY_PROTOCOL_VERSION = 1 as const;

export const MONGO_GATEWAY_OPERATIONS = [
  "ping",
  "findOne",
  "find",
  "aggregate",
  "countDocuments",
  "distinct",
  "insertOne",
  "insert",
  "insertMany",
  "batchInsert",
  "updateOne",
  "update",
  "updateMany",
  "batchUpdate",
  "replaceOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "findAndModify",
  "deleteOne",
  "delete",
  "deleteMany",
  "batchDelete",
  "bulkWrite",
] as const;

export type MongoGatewayOperation = (typeof MONGO_GATEWAY_OPERATIONS)[number];

export interface MongoGatewayRequest {
  version: typeof MONGO_GATEWAY_PROTOCOL_VERSION;
  requestId: string;
  deadlineAt?: number;
  collection?: string;
  operation: MongoGatewayOperation;
  args?: Record<string, unknown>;
}

export type MongoGatewayResponse =
  | {
      version: typeof MONGO_GATEWAY_PROTOCOL_VERSION;
      requestId: string;
      ok: true;
      result: unknown;
    }
  | {
      version: typeof MONGO_GATEWAY_PROTOCOL_VERSION;
      requestId: string;
      ok: false;
      error: {
        name: string;
        message: string;
        code?: string | number;
        codeName?: string;
        retryable: boolean;
      };
    };

type BsonEnvelope =
  | { $date: string }
  | { $oid: string }
  | { $regularExpression: { pattern: string; options: string } };

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Encode the small BSON subset that crosses the Worker service binding. */
export function encodeMongoValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Date) return { $date: value.toISOString() } satisfies BsonEnvelope;
  if (value instanceof RegExp) {
    return { $regularExpression: { pattern: value.source, options: value.flags } } satisfies BsonEnvelope;
  }
  if (Array.isArray(value)) return value.map(encodeMongoValue);
  if (!value || typeof value !== "object") return value;

  const bson = value as { _bsontype?: unknown; toHexString?: () => string };
  if (bson._bsontype === "ObjectId" && typeof bson.toHexString === "function") {
    return { $oid: bson.toHexString() } satisfies BsonEnvelope;
  }
  if (!isPlainObject(value)) return value;

  const encoded: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const converted = encodeMongoValue(item);
    if (converted !== undefined) encoded[key] = converted;
  }
  return encoded;
}

export function decodeMongoValue(value: unknown, objectId?: (hex: string) => unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => decodeMongoValue(item, objectId));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 1 && typeof record.$date === "string") return new Date(record.$date);
  if (Object.keys(record).length === 1 && typeof record.$oid === "string") {
    return objectId ? objectId(record.$oid) : record.$oid;
  }
  const expression = record.$regularExpression;
  if (Object.keys(record).length === 1 && expression && typeof expression === "object") {
    const pattern = (expression as Record<string, unknown>).pattern;
    const options = (expression as Record<string, unknown>).options;
    if (typeof pattern === "string" && typeof options === "string") return new RegExp(pattern, options);
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decodeMongoValue(item, objectId)]));
}

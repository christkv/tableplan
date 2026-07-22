import { BSON, MongoClient, type CommandStartedEvent, type Db } from "mongodb";

import { createLogger, FORMAT_LOG_CONTEXT, type LogContext, type Logger } from "../src/observability/logger";

export interface MongoConnectionConfig {
  MONGODB_URI: string;
  MONGODB_DATABASE: string;
  MONGODB_MAX_POOL_SIZE: number;
  MONGODB_MIN_POOL_SIZE: number;
  MONGODB_MAX_IDLE_TIME_MS: number;
  MONGODB_WAIT_QUEUE_TIMEOUT_MS: number;
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: number;
  MONGODB_MAX_CONNECTING: number;
  APP_ENV?: string;
  LOG_LEVEL?: string;
}

export interface MongoRuntime {
  readonly database: Db;
  readonly client: MongoClient;
  connect(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

const HIDDEN_COMMANDS = new Set(["authenticate", "hello", "ismaster", "saslContinue", "saslStart"]);
const SENSITIVE_COMMAND_FIELD = /(?:api[-_]?key|authorization|cookie|credential|password|refresh[-_]?token|secret|service[-_]?token|token)/i;

function redactMongoCommandValue(value: unknown, field?: string): unknown {
  if (field && SENSITIVE_COMMAND_FIELD.test(field)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactMongoCommandValue(item));
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([key, item]) => [String(key), redactMongoCommandValue(item, String(key))]));
  if (!value || typeof value !== "object") return value;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactMongoCommandValue(item, key)]),
  );
}

function inspectableMongoCommand(command: Record<string, unknown>): Record<string, unknown> {
  return redactMongoCommandValue(command) as Record<string, unknown>;
}

const formatMongoLogContext = (context: LogContext) => BSON.EJSON.stringify(context, undefined, 2, { relaxed: true });

export function mongoCommandContext(event: Pick<CommandStartedEvent, "commandName" | "databaseName" | "requestId" | "connectionId" | "command">) {
  const target = event.command[event.commandName];
  return {
    command: event.commandName,
    database: event.databaseName,
    ...(typeof target === "string" ? { collection: target } : {}),
    requestId: event.requestId,
    ...(event.connectionId === undefined ? {} : { connectionId: event.connectionId }),
    query: inspectableMongoCommand(event.command),
    [FORMAT_LOG_CONTEXT]: formatMongoLogContext,
  };
}

export function createMongoRuntime(config: MongoConnectionConfig, suppliedLogger?: Logger): MongoRuntime {
  const logger = suppliedLogger ?? createLogger(config, "mongodb");
  const commands = new Map<string, ReturnType<typeof mongoCommandContext>>();
  const client = new MongoClient(config.MONGODB_URI, {
    appName: "meal-planner-mongo-gateway",
    maxPoolSize: config.MONGODB_MAX_POOL_SIZE,
    minPoolSize: config.MONGODB_MIN_POOL_SIZE,
    maxIdleTimeMS: config.MONGODB_MAX_IDLE_TIME_MS,
    waitQueueTimeoutMS: config.MONGODB_WAIT_QUEUE_TIMEOUT_MS,
    serverSelectionTimeoutMS: config.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
    maxConnecting: config.MONGODB_MAX_CONNECTING,
    retryReads: true,
    retryWrites: true,
    monitorCommands: true,
  });
  const commandKey = (event: { address: string; connectionId?: string | number; requestId: number }) => `${event.address}:${String(event.connectionId ?? "")}:${event.requestId}`;
  client.on("commandStarted", (event) => {
    if (HIDDEN_COMMANDS.has(event.commandName)) return;
    const context = mongoCommandContext(event);
    commands.set(commandKey(event), context);
    logger.debug("command.started", context);
  });
  client.on("commandSucceeded", (event) => {
    if (HIDDEN_COMMANDS.has(event.commandName)) return;
    const key = commandKey(event);
    const context = commands.get(key) ?? { command: event.commandName, database: event.databaseName, requestId: event.requestId };
    commands.delete(key);
    logger.debug("command.succeeded", { ...context, durationMs: Math.round(event.duration * 100) / 100 });
  });
  client.on("commandFailed", (event) => {
    if (HIDDEN_COMMANDS.has(event.commandName)) return;
    const key = commandKey(event);
    const context = commands.get(key) ?? { command: event.commandName, database: event.databaseName, requestId: event.requestId };
    commands.delete(key);
    const failure = event.failure as Error & { code?: unknown; codeName?: unknown };
    logger.error("command.failed", {
      ...context,
      durationMs: Math.round(event.duration * 100) / 100,
      errorName: failure.name,
      ...(typeof failure.code === "number" || typeof failure.code === "string" ? { errorCode: failure.code } : {}),
      ...(typeof failure.codeName === "string" ? { errorCodeName: failure.codeName } : {}),
    });
  });
  const database = client.db(config.MONGODB_DATABASE);

  return {
    client,
    database,
    async connect() { await client.connect(); },
    async ping() { await database.command({ ping: 1 }); },
    async close() { await client.close(); },
  };
}

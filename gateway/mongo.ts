import { MongoClient, type ClientSession, type Db } from "mongodb";

export interface MongoConnectionConfig {
  MONGODB_URI: string;
  MONGODB_DATABASE: string;
  MONGODB_MAX_POOL_SIZE: number;
  MONGODB_MIN_POOL_SIZE: number;
  MONGODB_MAX_IDLE_TIME_MS: number;
  MONGODB_WAIT_QUEUE_TIMEOUT_MS: number;
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: number;
  MONGODB_MAX_CONNECTING: number;
}

export interface MongoRuntime {
  readonly database: Db;
  readonly client: MongoClient;
  connect(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
  withTransaction<T>(operation: (session: ClientSession) => Promise<T>): Promise<T>;
}

export function createMongoRuntime(config: MongoConnectionConfig): MongoRuntime {
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
  });
  const database = client.db(config.MONGODB_DATABASE);

  return {
    client,
    database,
    async connect() { await client.connect(); },
    async ping() { await database.command({ ping: 1 }); },
    async close() { await client.close(); },
    async withTransaction(operation) {
      const session = client.startSession();
      try { return await session.withTransaction(() => operation(session)); }
      finally { await session.endSession(); }
    },
  };
}

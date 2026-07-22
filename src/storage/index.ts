import { createApplicationStorageClient } from "./application-client";
import { createMongoGatewayClient, createMongoGatewayDatabase, type MongoGatewayClientEnvironment } from "./mongo-gateway";
import type { StorageClient } from "./contract";

type StorageEnvironment = CloudflareEnvironment & MongoGatewayClientEnvironment;

export function createStorageClient(env: StorageEnvironment): StorageClient {
  const mongo = createMongoGatewayClient(env);
  return createApplicationStorageClient(createMongoGatewayDatabase(mongo), mongo);
}

export { STORAGE_CONTRACT_VERSION } from "./contract";
export type { StorageBackend, StorageClient, StorageHealth } from "./contract";

import { MongoGatewayStorageClient } from "./gateway-client";
import { resolveMongoGatewayTransport, type MongoGatewayEnvironment } from "./gateway-transport";
import type { StorageClient } from "./contract";

type StorageEnvironment = CloudflareEnvironment & MongoGatewayEnvironment & {
  MONGODB_GATEWAY_SERVICE_TOKEN?: string;
};

function gateway(env: StorageEnvironment): MongoGatewayStorageClient {
  if (!env.MONGODB_GATEWAY_SERVICE_TOKEN) throw new Error("MONGODB_GATEWAY_SERVICE_TOKEN is required");
  const transport = resolveMongoGatewayTransport(env);
  return new MongoGatewayStorageClient({ baseUrl: transport.baseUrl, serviceToken: env.MONGODB_GATEWAY_SERVICE_TOKEN, fetcher: transport.fetcher });
}

export function createStorageClient(env: StorageEnvironment): StorageClient {
  return gateway(env);
}

export { STORAGE_CONTRACT_VERSION } from "./contract";
export type { StorageBackend, StorageClient, StorageHealth } from "./contract";

import { MongoGatewayStorageClient } from "./gateway-client";
import type { StorageClient } from "./contract";

type StorageEnvironment = CloudflareEnvironment & {
  MONGODB_GATEWAY_URL?: string;
  MONGODB_GATEWAY_SERVICE_TOKEN?: string;
};

function gateway(env: StorageEnvironment): MongoGatewayStorageClient {
  if (!env.MONGODB_GATEWAY_URL) throw new Error("MONGODB_GATEWAY_URL is required");
  if (!env.MONGODB_GATEWAY_SERVICE_TOKEN) throw new Error("MONGODB_GATEWAY_SERVICE_TOKEN is required");
  return new MongoGatewayStorageClient({ baseUrl: env.MONGODB_GATEWAY_URL, serviceToken: env.MONGODB_GATEWAY_SERVICE_TOKEN });
}

export function createStorageClient(env: StorageEnvironment): StorageClient {
  return gateway(env);
}

export { STORAGE_CONTRACT_VERSION } from "./contract";
export type { StorageBackend, StorageClient, StorageHealth } from "./contract";

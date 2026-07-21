import { D1StorageClient } from "./d1-client";
import { MongoGatewayStorageClient } from "./gateway-client";
import { storageBackendSchema, type StorageClient } from "./contract";
import { createShadowReadClient } from "./shadow-client";

type StorageEnvironment = CloudflareEnvironment & {
  STORAGE_BACKEND?: string;
  MONGODB_GATEWAY_URL?: string;
  MONGODB_GATEWAY_SERVICE_TOKEN?: string;
  STORAGE_SHADOW_READS?: string;
};

function gateway(env: StorageEnvironment): MongoGatewayStorageClient {
  if (!env.MONGODB_GATEWAY_URL) throw new Error("MONGODB_GATEWAY_URL is required for the mongodb-gateway storage backend");
  if (!env.MONGODB_GATEWAY_SERVICE_TOKEN) throw new Error("MONGODB_GATEWAY_SERVICE_TOKEN is required for the mongodb-gateway storage backend");
  return new MongoGatewayStorageClient({ baseUrl: env.MONGODB_GATEWAY_URL, serviceToken: env.MONGODB_GATEWAY_SERVICE_TOKEN });
}

export function createStorageClient(env: StorageEnvironment): StorageClient {
  const backend = storageBackendSchema.parse(env.STORAGE_BACKEND ?? "d1");
  if (backend === "d1") {
    const primary = new D1StorageClient(env.DB);
    return env.STORAGE_SHADOW_READS === "mongodb-gateway" ? createShadowReadClient(primary, gateway(env)) : primary;
  }
  return gateway(env);
}

export { STORAGE_CONTRACT_VERSION } from "./contract";
export type { StorageBackend, StorageClient, StorageHealth } from "./contract";

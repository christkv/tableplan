import type { Route } from "./+types/api.health";
import { cloudflareContext } from "../context";
import { createStorageClient, STORAGE_CONTRACT_VERSION } from "../../src/storage";

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  let health;
  try {
    health = await createStorageClient(env).health();
  } catch {
    health = {
      status: "unavailable" as const,
      backend: "mongodb-gateway" as const,
      latencyMs: 0,
      errorCode: "storage_configuration_invalid",
    };
  }
  const available = health.status === "ok";
  return Response.json({
    status: available ? "ok" : "degraded",
    database: available ? "ok" : "unavailable",
    storageBackend: health.backend,
    storageLatencyMs: Math.round(health.latencyMs * 100) / 100,
    storageErrorCode: health.errorCode ?? null,
    storageContractVersion: STORAGE_CONTRACT_VERSION,
    environment: env.APP_ENV,
    timestamp: new Date().toISOString(),
  }, { status: available ? 200 : 503 });
}

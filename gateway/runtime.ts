import type { GatewayConfig } from "./config";
import { createGatewayHandler } from "./app";
import { createMongoRuntime } from "./mongo";
import { createLogger } from "../src/observability/logger";

/** Build the operations-only MongoDB gateway runtime. */
export function createGatewayRuntime(config: GatewayConfig) {
  const logger = createLogger(config, "mongodb-gateway");
  const mongo = createMongoRuntime(config);
  const handler = createGatewayHandler({
    serviceToken: config.MONGODB_GATEWAY_SERVICE_TOKEN,
    maxBodyBytes: config.GATEWAY_MAX_BODY_BYTES,
    maxInFlight: config.GATEWAY_MAX_IN_FLIGHT,
    database: mongo.database,
    ping: () => mongo.ping(),
    log: (event) => {
      const { event: eventName, ...context } = event;
      if (eventName === "operation.failed") logger.error("operation.failed", context);
      else logger.debug(typeof eventName === "string" ? eventName : "operation", context);
    },
  });

  return { handler, logger, mongo };
}

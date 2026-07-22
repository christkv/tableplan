import type { GatewayConfig } from "./config";
import { createGatewayHandler } from "./app";
import { createMongoApiKeyStore } from "./api-keys";
import { createGatewayAuth } from "./auth";
import { createMongoEmailStore } from "./email";
import { createMongoHouseholdStore } from "./households";
import { createMongoIngestionStore } from "./ingestions";
import { createMongoRuntime } from "./mongo";
import { createMongoPlanStore } from "./plans";
import { createMongoRecipeStore } from "./recipes";
import { createMongoShareStore } from "./shares";
import { createMongoShoppingStore } from "./shopping";
import { createMongoTenantStore } from "./tenant";
import { createLogger } from "../src/observability/logger";

export function createGatewayRuntime(config: GatewayConfig, options: { waitUntil?: (promise: Promise<unknown>) => void } = {}) {
  const logger = createLogger(config, "mongodb-gateway");
  const mongo = createMongoRuntime(config);
  const recipes = createMongoRecipeStore(mongo.database);
  const plans = createMongoPlanStore(mongo.database, recipes, (operation) => mongo.withTransaction(operation));
  const shopping = createMongoShoppingStore(mongo.database, plans, recipes);
  const shares = createMongoShareStore(mongo.database, shopping);
  const auth = createGatewayAuth(config, mongo.database, mongo.client, options.waitUntil);
  const handler = createGatewayHandler({
    serviceToken: config.MONGODB_GATEWAY_SERVICE_TOKEN,
    maxBodyBytes: config.GATEWAY_MAX_BODY_BYTES,
    maxInFlight: config.GATEWAY_MAX_IN_FLIGHT,
    ping: () => mongo.ping(),
    recipes,
    tenant: createMongoTenantStore(mongo.database, recipes, (operation) => mongo.withTransaction(operation)),
    plans,
    shopping,
    shares,
    apiKeys: createMongoApiKeyStore(mongo.database),
    ingestions: createMongoIngestionStore(mongo.database, (operation) => mongo.withTransaction(operation)),
    authHandler: (request) => auth.handler(request),
    households: createMongoHouseholdStore(mongo.database, (operation) => mongo.withTransaction(operation)),
    email: createMongoEmailStore(mongo.database),
    log: (event) => {
      const { event: eventName, ...context } = event;
      logger.info(typeof eventName === "string" ? eventName : "event", context);
    },
  });

  return { handler, logger, mongo };
}

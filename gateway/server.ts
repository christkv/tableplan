import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createGatewayHandler } from "./app";
import { loadGatewayConfig } from "./config";
import { createMongoRuntime } from "./mongo";
import { createMongoRecipeStore } from "./recipes";
import { createMongoTenantStore } from "./tenant";
import { createMongoPlanStore } from "./plans";
import { createMongoShoppingStore } from "./shopping";
import { createMongoShareStore } from "./shares";
import { createMongoApiKeyStore } from "./api-keys";
import { createMongoIngestionStore } from "./ingestions";
import { createGatewayAuth } from "./auth";
import { createMongoHouseholdStore } from "./households";
import { createMongoEmailStore } from "./email";
import { createLogger, errorLogContext } from "../src/observability/logger";

function toRequest(request: IncomingMessage): Request {
  const origin = `http://${request.headers.host ?? "127.0.0.1"}`;
  const method = request.method ?? "GET";
  return new Request(new URL(request.url ?? "/", origin), {
    method,
    headers: request.headers as unknown as Record<string, string>,
    body: method === "GET" || method === "HEAD" ? undefined : request as unknown as string,
    duplex: method === "GET" || method === "HEAD" ? undefined : "half",
  } as RequestInit);
}

async function writeResponse(response: Response, target: ServerResponse) {
  target.statusCode = response.status;
  response.headers.forEach((value, key) => { if (key !== "set-cookie") target.setHeader(key, value); });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) target.setHeader("set-cookie", cookies);
  target.end(Buffer.from(await response.arrayBuffer()));
}

const config = loadGatewayConfig(process.env);
const logger = createLogger(config, "mongodb-gateway");
const mongo = createMongoRuntime(config);
await mongo.connect();
logger.info("connected", { database: config.MONGODB_DATABASE });

const recipes = createMongoRecipeStore(mongo.database);
const plans = createMongoPlanStore(mongo.database, recipes, (operation) => mongo.withTransaction(operation));
const shopping = createMongoShoppingStore(mongo.database, plans, recipes);
const shares = createMongoShareStore(mongo.database, shopping);
const auth = createGatewayAuth(config, mongo.database, mongo.client);
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
const server = createServer(async (request, response) => {
  try {
    await writeResponse(await handler(toRequest(request)), response);
  } catch (error) {
    logger.error("request.failed", errorLogContext(error));
    response.statusCode = 500;
    response.end();
  }
});

server.listen(config.GATEWAY_PORT, config.GATEWAY_HOST, () => {
  logger.info("listening", { host: config.GATEWAY_HOST, port: config.GATEWAY_PORT, logLevel: config.LOG_LEVEL });
});

async function shutdown() {
  logger.info("shutdown.started");
  server.close();
  await mongo.close();
  logger.info("shutdown.completed");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

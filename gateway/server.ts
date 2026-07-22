import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { loadGatewayConfig } from "./config";
import { createGatewayRuntime } from "./runtime";
import { errorLogContext } from "../src/observability/logger";

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
const { handler, logger, mongo } = createGatewayRuntime(config);
await mongo.connect();
logger.info("connected", { database: config.MONGODB_DATABASE });
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

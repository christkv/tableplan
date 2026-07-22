export interface MongoGatewayBinding {
  fetch(request: Request): Promise<Response>;
}

export interface MongoGatewayEnvironment {
  MONGODB_GATEWAY?: MongoGatewayBinding;
  MONGODB_GATEWAY_URL?: string;
}

export interface MongoGatewayTransport {
  baseUrl: string;
  fetcher: typeof fetch;
  kind: "service-binding" | "url";
}

const internalGatewayOrigin = "https://mongodb-gateway.internal";

export function resolveMongoGatewayTransport(env: MongoGatewayEnvironment): MongoGatewayTransport {
  if (env.MONGODB_GATEWAY) {
    const binding = env.MONGODB_GATEWAY;
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => binding.fetch(new Request(input, init))) as typeof fetch;
    return { baseUrl: internalGatewayOrigin, fetcher, kind: "service-binding" };
  }
  if (env.MONGODB_GATEWAY_URL) {
    return { baseUrl: env.MONGODB_GATEWAY_URL, fetcher: fetch, kind: "url" };
  }
  throw new Error("MONGODB_GATEWAY service binding or MONGODB_GATEWAY_URL is required");
}

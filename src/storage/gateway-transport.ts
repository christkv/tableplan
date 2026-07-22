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
    // Cloudflare's global fetch validates its receiver. Do not pass the native
    // function through directly: MongoGatewayClient stores it as an object
    // property, and a later `options.fetcher()` call would supply the wrong
    // `this` value and throw "Illegal invocation".
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;
    return { baseUrl: env.MONGODB_GATEWAY_URL, fetcher, kind: "url" };
  }
  throw new Error("MONGODB_GATEWAY service binding or MONGODB_GATEWAY_URL is required");
}

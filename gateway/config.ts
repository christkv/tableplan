import { z } from "zod";

const integer = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const logLevel = z.preprocess(
  (value) => typeof value === "string" ? value.trim().toUpperCase() : value,
  z.enum(["DEBUG", "INFO", "ERROR"]).default("INFO"),
);

const gatewayConfigSchema = z.object({
  MONGODB_URI: z.string().min(1),
  MONGODB_DATABASE: z.string().min(1).default("application_local"),
  MONGODB_GATEWAY_SERVICE_TOKEN: z.string().min(32),
  GATEWAY_HOST: z.string().default("127.0.0.1"),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  MONGODB_MAX_POOL_SIZE: integer(10),
  MONGODB_MIN_POOL_SIZE: z.coerce.number().int().nonnegative().default(0),
  MONGODB_MAX_IDLE_TIME_MS: integer(60_000),
  MONGODB_WAIT_QUEUE_TIMEOUT_MS: integer(2_000),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: integer(3_000),
  MONGODB_MAX_CONNECTING: integer(2),
  GATEWAY_MAX_BODY_BYTES: integer(1_048_576),
  GATEWAY_MAX_IN_FLIGHT: integer(100),
  APP_ENV: z.string().default("local"),
  LOG_LEVEL: logLevel,
  BETTER_AUTH_URL: z.string().url().default("http://127.0.0.1:5173"),
  BETTER_AUTH_SECRET: z.string().min(32).default("local-only-secret-change-before-deployment-32-chars"),
  BETTER_AUTH_API_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

export function loadGatewayConfig(environment: NodeJS.ProcessEnv): GatewayConfig {
  const appEnv = environment.APP_ENV ?? "local";
  const expectedDatabase = appEnv === "preview"
    ? "application_preview"
    : appEnv === "production"
      ? "application"
      : appEnv === "local"
        ? "application_local"
        : undefined;
  const config = gatewayConfigSchema.parse({
    ...environment,
    ...(environment.MONGODB_DATABASE ? {} : { MONGODB_DATABASE: expectedDatabase ?? "application_local" }),
  });
  if (config.MONGODB_MIN_POOL_SIZE > config.MONGODB_MAX_POOL_SIZE) {
    throw new Error("MONGODB_MIN_POOL_SIZE cannot exceed MONGODB_MAX_POOL_SIZE");
  }
  if (expectedDatabase && config.MONGODB_DATABASE !== expectedDatabase) {
    throw new Error(`${config.APP_ENV} must use MongoDB database ${expectedDatabase}`);
  }
  if (config.APP_ENV !== "local" && config.BETTER_AUTH_SECRET.startsWith("local-only-secret")) throw new Error("BETTER_AUTH_SECRET is required outside local development");
  return config;
}

import { describe, expect, it } from "vitest";

import { loadGatewayConfig } from "./config";

const base = {
  MONGODB_URI: "mongodb://127.0.0.1:27017/?replicaSet=rs0",
  MONGODB_GATEWAY_SERVICE_TOKEN: "a-secure-test-service-token-at-least-32-chars",
};

describe("gateway configuration", () => {
  it("applies conservative pool defaults", () => {
    expect(loadGatewayConfig(base)).toMatchObject({
      MONGODB_MAX_POOL_SIZE: 10,
      MONGODB_MIN_POOL_SIZE: 0,
      MONGODB_MAX_CONNECTING: 2,
      GATEWAY_PORT: 8788,
      MONGODB_DATABASE: "application_local",
    });
  });

  it("rejects a minimum pool larger than the maximum", () => {
    expect(() => loadGatewayConfig({ ...base, MONGODB_MIN_POOL_SIZE: "11", MONGODB_MAX_POOL_SIZE: "10" })).toThrow("cannot exceed");
  });

  it("selects and enforces the preview database", () => {
    const preview = { ...base, APP_ENV: "preview", BETTER_AUTH_SECRET: "preview-auth-secret-at-least-32-characters" };
    expect(loadGatewayConfig(preview).MONGODB_DATABASE).toBe("application_preview");
    expect(() => loadGatewayConfig({ ...preview, MONGODB_DATABASE: "application" })).toThrow("preview must use MongoDB database application_preview");
  });

  it("selects and enforces the production database", () => {
    const production = { ...base, APP_ENV: "production", BETTER_AUTH_SECRET: "production-auth-secret-at-least-32-characters" };
    expect(loadGatewayConfig(production).MONGODB_DATABASE).toBe("application");
    expect(() => loadGatewayConfig({ ...production, MONGODB_DATABASE: "application_preview" })).toThrow("production must use MongoDB database application");
  });
});

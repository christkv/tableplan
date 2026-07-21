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
    });
  });

  it("rejects a minimum pool larger than the maximum", () => {
    expect(() => loadGatewayConfig({ ...base, MONGODB_MIN_POOL_SIZE: "11", MONGODB_MAX_POOL_SIZE: "10" })).toThrow("cannot exceed");
  });
});

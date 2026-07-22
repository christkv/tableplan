import { beforeEach, describe, expect, it, vi } from "vitest";

const { betterAuth, dash, mongodbAdapter } = vi.hoisted(() => ({
  betterAuth: vi.fn((options) => options),
  dash: vi.fn(() => ({ id: "dash" })),
  mongodbAdapter: vi.fn(() => ({ adapter: "mongodb" })),
}));

vi.mock("better-auth", () => ({ betterAuth }));
vi.mock("better-auth/adapters/mongodb", () => ({ mongodbAdapter }));
vi.mock("better-auth/plugins/username", () => ({ username: vi.fn(() => ({ id: "username" })) }));
vi.mock("@better-auth/infra", () => ({ dash }));

import { createGatewayAuth } from "./auth";
import type { GatewayConfig } from "./config";

describe("gateway auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables Better Auth Mongo transactions in the Worker runtime", () => {
    const database = { databaseName: "application_preview" };
    const client = { startSession: vi.fn() };
    const config = {
      APP_ENV: "preview",
      BETTER_AUTH_API_KEY: "test-api-key",
      BETTER_AUTH_API_TIMEOUT_MS: 10_000,
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "https://family-meal-planner-preview.example.com",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
    } as GatewayConfig;

    createGatewayAuth(config, database as never, client as never);

    expect(mongodbAdapter).toHaveBeenCalledWith(database, {
      client,
      usePlural: true,
      transaction: false,
    });
    expect(betterAuth).toHaveBeenCalledOnce();
    expect(betterAuth.mock.calls[0]![0]).toMatchObject({
      onAPIError: {
        errorURL: "https://family-meal-planner-preview.example.com/auth/error",
      },
      logger: {
        level: "debug",
        disableColors: true,
      },
    });
    expect(dash).toHaveBeenCalledWith({ apiKey: "test-api-key", apiTimeout: 10_000 });
  });
});

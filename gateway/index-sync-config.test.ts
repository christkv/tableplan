import { describe, expect, it } from "vitest";

import { resolveIndexSyncTarget } from "./index-sync-config";

describe("MongoDB index sync target safety", () => {
  it("maps each environment to its exact database", () => {
    expect(resolveIndexSyncTarget(["--environment", "local"], { APP_ENV: "local", MONGODB_URI: "mongodb://local", MONGODB_DATABASE: "application_local" })).toMatchObject({ environment: "local", database: "application_local" });
    expect(resolveIndexSyncTarget(["--environment", "preview"], { APP_ENV: "preview", MONGODB_URI: "mongodb://preview", MONGODB_DATABASE: "application_preview" })).toMatchObject({ environment: "preview", database: "application_preview" });
  });

  it("rejects a mismatched environment or database", () => {
    expect(() => resolveIndexSyncTarget(["--environment", "preview"], { APP_ENV: "production", MONGODB_URI: "mongodb://cluster", MONGODB_DATABASE: "application_preview" })).toThrow("does not match");
    expect(() => resolveIndexSyncTarget(["--environment", "production", "--confirm-production"], { APP_ENV: "production", MONGODB_URI: "mongodb://cluster", MONGODB_DATABASE: "application_preview" })).toThrow("MONGODB_DATABASE=application");
  });

  it("allows a production dry run but guards production changes", () => {
    const environment = { APP_ENV: "production", MONGODB_URI: "mongodb://production", MONGODB_DATABASE: "application" };
    expect(resolveIndexSyncTarget(["--environment", "production", "--dry-run"], environment)).toMatchObject({ dryRun: true });
    expect(() => resolveIndexSyncTarget(["--environment", "production"], environment)).toThrow("--confirm-production");
    expect(resolveIndexSyncTarget(["--environment", "production", "--confirm-production"], environment)).toMatchObject({ dryRun: false });
  });
});

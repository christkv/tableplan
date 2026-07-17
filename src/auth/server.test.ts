import { describe, expect, it } from "vitest";

import { authTrustedOrigins } from "./server";

describe("authTrustedOrigins", () => {
  it("accepts both normal local development hostnames", () => {
    expect(authTrustedOrigins("local", "http://localhost:5173")).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
  });

  it("restricts deployed environments to the configured origin", () => {
    expect(authTrustedOrigins("production", "https://tableplan.example/path")).toEqual([
      "https://tableplan.example",
    ]);
  });
});

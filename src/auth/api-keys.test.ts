import { describe, expect, it } from "vitest";

import { apiKeyPrefix, hashApiKey } from "./api-keys";

describe("API key material", () => {
  it("hashes deterministically without retaining the secret", async () => {
    const hash = await hashApiKey("mp_test_example-secret");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("example-secret");
    expect(await hashApiKey("mp_test_example-secret")).toBe(hash);
  });
  it("uses only a bounded lookup prefix", () => {
    expect(apiKeyPrefix("mp_test_abcdefghijklmnopqrstuvwxyz")).toBe("mp_test_abcdefghijkl");
  });
});

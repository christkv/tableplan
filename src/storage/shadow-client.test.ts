import { describe, expect, it, vi } from "vitest";

import type { StorageClient } from "./contract";
import { createShadowReadClient } from "./shadow-client";

describe("shadow read client", () => {
  it("returns the primary result and reports a mismatch without writing to the shadow", async () => {
    const primary = { getUserEmail: vi.fn(async () => "primary@example.test"), revokeApiKey: vi.fn(async () => undefined) } as unknown as StorageClient;
    const shadow = { getUserEmail: vi.fn(async () => "shadow@example.test"), revokeApiKey: vi.fn(async () => undefined) } as unknown as StorageClient;
    const report = vi.fn(); const client = createShadowReadClient(primary, shadow, report);
    await expect(client.getUserEmail("user-1")).resolves.toBe("primary@example.test");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ operation: "getUserEmail", outcome: "mismatch" }));
    await client.revokeApiKey("user-1", "key-1");
    expect(primary.revokeApiKey).toHaveBeenCalledOnce();
    expect(shadow.revokeApiKey).not.toHaveBeenCalled();
  });

  it("does not fail a primary read when the shadow is unavailable", async () => {
    const primary = { getUserEmail: vi.fn(async () => "user@example.test") } as unknown as StorageClient;
    const shadow = { getUserEmail: vi.fn(async () => { throw new Error("unavailable"); }) } as unknown as StorageClient;
    const report = vi.fn();
    await expect(createShadowReadClient(primary, shadow, report).getUserEmail("user-1")).resolves.toBe("user@example.test");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ outcome: "shadow_error" }));
  });
});

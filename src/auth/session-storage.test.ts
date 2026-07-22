import { describe, expect, it, vi } from "vitest";

import { createAuthSessionStorage } from "./session-storage";

describe("Cloudflare auth session storage", () => {
  it("routes a key consistently and exposes atomic operations", async () => {
    const stub = {
      getValue: vi.fn(async () => "session"),
      setValue: vi.fn(async () => undefined),
      deleteValue: vi.fn(async () => undefined),
      getAndDeleteValue: vi.fn(async () => "session"),
      incrementValue: vi.fn(async () => 2),
    };
    const idFromName = vi.fn((name: string) => name as unknown as DurableObjectId);
    const get = vi.fn(() => stub);
    const storage = createAuthSessionStorage({ idFromName, get });

    await expect(storage.get("session-token")).resolves.toBe("session");
    await storage.set("session-token", "value", 60);
    await expect(storage.getAndDelete("session-token")).resolves.toBe("session");
    await expect(storage.increment("session-token", 60)).resolves.toBe(2);
    await storage.delete("session-token");

    expect(new Set(idFromName.mock.calls.map(([name]) => name)).size).toBe(1);
    expect(stub.setValue).toHaveBeenCalledWith("value", 60);
  });
});

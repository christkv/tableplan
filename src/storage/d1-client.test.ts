import { describe, expect, it, vi } from "vitest";

import { D1StorageClient } from "./d1-client";

function databaseWith(first: () => Promise<unknown>): D1Database {
  return {
    prepare: vi.fn(() => ({ first })),
  } as unknown as D1Database;
}

describe("D1StorageClient", () => {
  it("reports a healthy D1 dependency", async () => {
    const database = databaseWith(async () => ({ ok: 1 }));

    await expect(new D1StorageClient(database).health()).resolves.toMatchObject({
      status: "ok",
      backend: "d1",
    });
    expect(database.prepare).toHaveBeenCalledWith("SELECT 1 AS ok");
  });

  it("returns a stable error code without leaking the database error", async () => {
    const database = databaseWith(async () => {
      throw new Error("secret connection detail");
    });

    await expect(new D1StorageClient(database).health()).resolves.toMatchObject({
      status: "unavailable",
      backend: "d1",
      errorCode: "d1_unavailable",
    });
  });
});

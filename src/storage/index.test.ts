import { describe, expect, it, vi } from "vitest";

import { STORAGE_CONTRACT_VERSION } from "./contract";
import { createStorageClient } from "./index";

describe("createStorageClient", () => {
  it("uses the private service binding when it is available", async () => {
    const binding = {
      fetch: vi.fn(async function (this: unknown, request: Request) {
        expect(this).toBe(binding);
        expect(new URL(request.url).origin).toBe("https://mongodb-gateway.internal");
        const body = await request.json() as { requestId: string };
        return Response.json({
          contractVersion: STORAGE_CONTRACT_VERSION,
          requestId: body.requestId,
          ok: true,
          result: { status: "ok", backend: "mongodb-gateway", latencyMs: 1 },
        });
      }),
    };
    const client = createStorageClient({
      MONGODB_GATEWAY: binding,
      MONGODB_GATEWAY_URL: "https://public-gateway.example.test",
      MONGODB_GATEWAY_SERVICE_TOKEN: "service-token",
    } as unknown as CloudflareEnvironment);

    await expect(client.health()).resolves.toMatchObject({ status: "ok", backend: "mongodb-gateway" });
    expect(binding.fetch).toHaveBeenCalledOnce();
  });
});

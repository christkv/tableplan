import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveMongoGatewayTransport } from "./gateway-transport";

describe("MongoDB gateway transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls the Cloudflare global fetch with the correct receiver", async () => {
    const nativeFetch = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(new Response("ok"));
    });
    vi.stubGlobal("fetch", nativeFetch);

    const transport = resolveMongoGatewayTransport({ MONGODB_GATEWAY_URL: "http://127.0.0.1:8790" });
    await expect(transport.fetcher(new Request("http://127.0.0.1:8790/healthz"))).resolves.toMatchObject({ status: 200 });
    expect(nativeFetch).toHaveBeenCalledOnce();
  });
});

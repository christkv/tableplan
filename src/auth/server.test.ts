import { describe, expect, it, vi } from "vitest";

import { handleAuthRequest } from "./server";

describe("gateway-backed authentication", () => {
  it("invokes the local URL fetcher without rebinding its receiver", async () => {
    const fetcher = vi.fn(async function (this: unknown, request: Request) {
      expect(this).toBeUndefined();
      expect(request.url).toBe("http://127.0.0.1:8790/api/auth/get-session");
      return Response.json(null);
    });
    vi.stubGlobal("fetch", fetcher);
    const env = {
      MONGODB_GATEWAY_URL: "http://127.0.0.1:8790",
      MONGODB_GATEWAY_SERVICE_TOKEN: "service-token",
    } as unknown as CloudflareEnvironment;

    try {
      const response = await handleAuthRequest(new Request("http://127.0.0.1:5173/api/auth/get-session"), env, {} as ExecutionContext);
      expect(response.status).toBe(200);
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("forwards auth requests through the private service binding", async () => {
    const binding = {
      fetch: vi.fn(async function (this: unknown, request: Request) {
        expect(this).toBe(binding);
        expect(request.method).toBe("POST");
        expect(new URL(request.url)).toMatchObject({ origin: "https://mongodb-gateway.internal", pathname: "/api/auth/sign-in/email", search: "?return=1" });
        expect(request.headers.get("x-forwarded-origin")).toBe("https://tableplan.example.test");
        expect(request.headers.get("x-tableplan-service-token")).toBe("Bearer service-token");
        expect(await request.json()).toEqual({ email: "person@example.test" });
        return Response.json({ ok: true });
      }),
    };
    const env = {
      MONGODB_GATEWAY: binding,
      MONGODB_GATEWAY_URL: "https://public-gateway.example.test",
      MONGODB_GATEWAY_SERVICE_TOKEN: "service-token",
    } as unknown as CloudflareEnvironment;
    const request = new Request("https://tableplan.example.test/api/auth/sign-in/email?return=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "person@example.test" }),
    });

    const response = await handleAuthRequest(request, env, {} as ExecutionContext);

    expect(response.status).toBe(200);
    expect(binding.fetch).toHaveBeenCalledOnce();
  });
});

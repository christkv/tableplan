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

  it("shows callback gateway failures on the application auth error page", async () => {
    const binding = { fetch: vi.fn(async () => Response.json({ error: "gateway_unavailable" }, { status: 503 })) };
    const env = {
      MONGODB_GATEWAY: binding,
      MONGODB_GATEWAY_SERVICE_TOKEN: "service-token",
      APP_ENV: "preview",
      LOG_LEVEL: "ERROR",
    } as unknown as CloudflareEnvironment;

    const response = await handleAuthRequest(
      new Request("https://tableplan.example.test/api/auth/callback/google?code=secret-code"),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/auth/error");
    expect(location.searchParams.get("error")).toBe("gateway_unavailable");
    expect(location.searchParams.get("request_id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(location.toString()).not.toContain("secret-code");
  });

  it("adds the correlated request identifier to Better Auth error redirects", async () => {
    const binding = {
      // Response.redirect uses an immutable header guard, matching a redirect
      // returned through a Cloudflare service binding.
      fetch: vi.fn(async (_request: Request) => Response.redirect(
        "https://tableplan.example.test/auth/error?error=unable_to_create_user",
        302,
      )),
    };
    const env = {
      MONGODB_GATEWAY: binding,
      MONGODB_GATEWAY_SERVICE_TOKEN: "service-token",
      APP_ENV: "preview",
      LOG_LEVEL: "ERROR",
    } as unknown as CloudflareEnvironment;

    const response = await handleAuthRequest(
      new Request("https://tableplan.example.test/api/auth/callback/google"),
      env,
      {} as ExecutionContext,
    );

    const location = new URL(response.headers.get("location")!);
    const forwardedRequest = binding.fetch.mock.calls[0]![0] as Request;
    expect(location.searchParams.get("error")).toBe("unable_to_create_user");
    expect(location.searchParams.get("request_id")).toBe(forwardedRequest.headers.get("x-request-id"));
  });

  it("clones immutable headers on successful OAuth redirects", async () => {
    const binding = {
      // Response.redirect has an immutable header guard, matching a redirect
      // returned through a Cloudflare service binding.
      fetch: vi.fn(async () => Response.redirect(
        "https://tableplan.example.test/recipes",
        302,
      )),
    };
    const env = {
      MONGODB_GATEWAY: binding,
      MONGODB_GATEWAY_SERVICE_TOKEN: "service-token",
      APP_ENV: "preview",
      LOG_LEVEL: "ERROR",
    } as unknown as CloudflareEnvironment;

    const response = await handleAuthRequest(
      new Request("https://tableplan.example.test/api/auth/callback/google?code=valid-code"),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://tableplan.example.test/recipes");
    expect(() => response.headers.set("x-router-merged", "true")).not.toThrow();
    expect(response.headers.get("x-router-merged")).toBe("true");
  });

  it("returns a safe diagnostic response when a non-callback gateway request throws", async () => {
    const binding = { fetch: vi.fn(async () => { throw new Error("mongodb://user:password@private-host"); }) };
    const env = {
      MONGODB_GATEWAY: binding,
      MONGODB_GATEWAY_SERVICE_TOKEN: "service-token",
      APP_ENV: "preview",
      LOG_LEVEL: "ERROR",
    } as unknown as CloudflareEnvironment;

    const response = await handleAuthRequest(
      new Request("https://tableplan.example.test/api/auth/get-session"),
      env,
      {} as ExecutionContext,
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain("authentication_service_unavailable");
    expect(body).toContain("requestId");
    expect(body).not.toContain("private-host");
    expect(body).not.toContain("password");
  });
});

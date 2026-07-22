import { describe, expect, it, vi } from "vitest";

import { STORAGE_CONTRACT_VERSION } from "./contract";
import { MongoGatewayStorageClient } from "./gateway-client";
import { HouseholdInvitationError } from "../domain/households";

describe("MongoGatewayStorageClient", () => {
  it("sends a versioned health operation and validates its response", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { requestId: string };
      return Response.json({
        contractVersion: STORAGE_CONTRACT_VERSION,
        requestId: request.requestId,
        ok: true,
        result: { status: "ok", backend: "mongodb-gateway", latencyMs: 1 },
      });
    }) as unknown as typeof fetch;
    const client = new MongoGatewayStorageClient({
      baseUrl: "https://mongo-gateway.example.com/",
      serviceToken: "test-service-token",
      fetcher,
    });

    await expect(client.health()).resolves.toMatchObject({ status: "ok", backend: "mongodb-gateway" });
    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe("https://mongo-gateway.example.com/v1/rpc");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-service-token");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      contractVersion: STORAGE_CONTRACT_VERSION,
      operation: "system.health",
      input: {},
    });
  });

  it("invokes fetch without rebinding its receiver for the Workers runtime", async () => {
    const fetcher = vi.fn(async function (this: unknown, _input: RequestInfo | URL, init?: RequestInit) {
      expect(this).toBeUndefined();
      const request = JSON.parse(String(init?.body)) as { requestId: string };
      return Response.json({
        contractVersion: STORAGE_CONTRACT_VERSION,
        requestId: request.requestId,
        ok: true,
        result: { status: "ok", backend: "mongodb-gateway", latencyMs: 1 },
      });
    }) as unknown as typeof fetch;
    const client = new MongoGatewayStorageClient({
      baseUrl: "https://mongo-gateway.example.com",
      serviceToken: "test-service-token",
      fetcher,
    });

    await expect(client.health()).resolves.toMatchObject({ status: "ok" });
  });

  it("sends only the facet filters accepted by the gateway contract", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { requestId: string; input: { search: unknown } };
      expect(request.input.search).toEqual({ query: "pasta", ingredient: "tomato", scope: "catalog" });
      return Response.json({
        contractVersion: STORAGE_CONTRACT_VERSION,
        requestId: request.requestId,
        ok: true,
        result: [],
      });
    }) as unknown as typeof fetch;
    const client = new MongoGatewayStorageClient({
      baseUrl: "https://mongo-gateway.example.com",
      serviceToken: "test-service-token",
      fetcher,
    });
    const filters = { query: "pasta", ingredient: "tomato", scope: "catalog" as const, tags: ["Dinner"], tagMatch: "all" as const };

    await expect(client.listRecipeTagFacets(filters, { userId: "user-1", householdId: "household-1" })).resolves.toEqual([]);
  });

  it("accepts paged recipe results with a lower-bound total", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { requestId: string };
      return Response.json({
        contractVersion: STORAGE_CONTRACT_VERSION,
        requestId: request.requestId,
        ok: true,
        result: { recipes: [], hasMore: true, total: { value: 25, relation: "lowerBound" }, limit: 24, offset: 0 },
      });
    }) as unknown as typeof fetch;
    const client = new MongoGatewayStorageClient({
      baseUrl: "https://mongo-gateway.example.com",
      serviceToken: "test-service-token",
      fetcher,
    });

    await expect(client.searchRecipes({}, { userId: "user-1", householdId: "household-1" })).resolves.toMatchObject({
      hasMore: true,
      total: { value: 25, relation: "lowerBound" },
    });
  });

  it("rejects an invalid or mismatched gateway response", async () => {
    const fetcher = vi.fn(async () => Response.json({
      contractVersion: STORAGE_CONTRACT_VERSION,
      requestId: "wrong-request",
      ok: true,
      result: { status: "ok", backend: "mongodb-gateway", latencyMs: 1 },
    })) as unknown as typeof fetch;
    const client = new MongoGatewayStorageClient({
      baseUrl: "https://mongo-gateway.example.com",
      serviceToken: "test-service-token",
      fetcher,
    });

    await expect(client.health()).resolves.toMatchObject({
      status: "unavailable",
      errorCode: "gateway_invalid_response",
    });
  });

  it("does not allow clear-text remote gateway URLs", () => {
    expect(() => new MongoGatewayStorageClient({
      baseUrl: "http://mongo-gateway.example.com",
      serviceToken: "test-service-token",
    })).toThrow("must use HTTPS");
  });

  it("reconstructs typed domain errors returned by the gateway", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { requestId: string };
      return Response.json({ contractVersion: STORAGE_CONTRACT_VERSION, requestId: request.requestId, ok: false, error: { code: "owner_required", message: "Only the owner can do that.", retryable: false } });
    }) as unknown as typeof fetch;
    const client = new MongoGatewayStorageClient({ baseUrl: "https://mongo-gateway.example.com", serviceToken: "test-service-token", fetcher });
    await expect(client.revokeHouseholdInvitation("house-1", "user-1", "invite-1")).rejects.toBeInstanceOf(HouseholdInvitationError);
  });
});

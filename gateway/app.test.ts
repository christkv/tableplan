import { describe, expect, it, vi } from "vitest";

import { STORAGE_CONTRACT_VERSION } from "../src/storage/contract";
import { createGatewayHandler } from "./app";

const token = "a-secure-test-service-token-at-least-32-chars";
const recipes = {
  search: vi.fn(),
  facets: vi.fn(),
  get: vi.fn(),
};
const tenant = {
  isFavorite: vi.fn(), setFavorite: vi.fn(), listFavorites: vi.fn(), getMeasurementSystem: vi.fn(), updateMeasurementSystem: vi.fn(),
  getSlots: vi.fn(), updateSlots: vi.fn(), listSavedSearches: vi.fn(), createSavedSearch: vi.fn(), deleteSavedSearch: vi.fn(),
  ensureUserHousehold: vi.fn(), getUserEmail: vi.fn(),
};
const plans = { get: vi.fn(), getById: vi.fn(), getItemContext: vi.fn(), ensure: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(), updateServings: vi.fn(), copyWeek: vi.fn() };
const shopping = { generate: vi.fn(), refreshPlan: vi.fn(), refreshRecipe: vi.fn(), getLatest: vi.fn(), getById: vi.fn(), getForPlan: vi.fn(), toggle: vi.fn(), getPublic: vi.fn(), togglePublic: vi.fn() };
const shares = { create: vi.fn(), resolve: vi.fn(), revoke: vi.fn(), list: vi.fn(), getPublicList: vi.fn(), togglePublic: vi.fn(), touch: vi.fn() };
const apiKeys = { create: vi.fn(), list: vi.fn(), revoke: vi.fn(), authenticate: vi.fn() };
const ingestions = { create: vi.fn(), attachArtifact: vi.fn(), updateStatus: vi.fn(), saveDraft: vi.fn(), get: vi.fn(), getArtifact: vi.fn(), candidates: vi.fn(), publish: vi.fn(), setVisibility: vi.fn(), updateOwned: vi.fn() };
const households = { overview: vi.fn(), switchDefault: vi.fn(), createInvitation: vi.fn(), revokeInvitation: vi.fn(), resolveInvitation: vi.fn(), acceptInvitation: vi.fn(), claimInvitationEmail: vi.fn(), updateInvitationDelivery: vi.fn() };
const email = { create: vi.fn(), claim: vi.fn(), update: vi.fn(), get: vi.fn() };

function rpcRequest(overrides: RequestInit = {}) {
  return new Request("https://gateway.example.com/v1/rpc", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ contractVersion: STORAGE_CONTRACT_VERSION, requestId: "request-1", operation: "system.health", input: {} }),
    ...overrides,
  });
}

describe("gateway handler", () => {
  it("serves authenticated health RPC without exposing MongoDB details", async () => {
    const ping = vi.fn(async () => undefined);
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 1024, ping, recipes, tenant, plans, shopping, shares, apiKeys, ingestions, households, email, now: () => 10 });
    const response = await handler(rpcRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      contractVersion: STORAGE_CONTRACT_VERSION,
      requestId: "request-1",
      ok: true,
      result: { status: "ok", backend: "mongodb-gateway" },
    });
    expect(ping).toHaveBeenCalledOnce();
  });

  it("rejects missing credentials", async () => {
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 1024, ping: vi.fn(), recipes, tenant, plans, shopping, shares, apiKeys, ingestions, households, email });
    const response = await handler(rpcRequest({ headers: { "content-type": "application/json" } }));
    expect(response.status).toBe(401);
  });

  it("reports dependency failure with a stable non-secret error", async () => {
    const handler = createGatewayHandler({
      serviceToken: token,
      maxBodyBytes: 1024,
      ping: async () => { throw new Error("mongodb://username:password@secret-host"); },
      recipes,
      tenant,
      plans,
      shopping,
      shares,
      apiKeys,
      ingestions,
      households,
      email,
    });
    const response = await handler(rpcRequest());
    const body = await response.text();
    expect(body).toContain("storage_operation_failed");
    expect(body).not.toContain("secret-host");
  });

  it("dispatches API-key authentication without exposing the key in its response envelope", async () => {
    apiKeys.authenticate.mockResolvedValueOnce({ id: "key-1", userId: "user-1", householdId: "house-1", scopes: ["recipes:read"] });
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 2048, ping: vi.fn(), recipes, tenant, plans, shopping, shares, apiKeys, ingestions, households, email });
    const response = await handler(rpcRequest({ body: JSON.stringify({ contractVersion: STORAGE_CONTRACT_VERSION, requestId: "request-key", operation: "apiKeys.authenticate", input: { key: "mp_test_secret" } }) }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ requestId: "request-key", ok: true, result: { id: "key-1" } });
    expect(apiKeys.authenticate).toHaveBeenCalledWith("mp_test_secret");
  });

  it("rejects an expired caller deadline before touching storage", async () => {
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 2048, ping: vi.fn(), recipes, tenant, plans, shopping, shares, apiKeys, ingestions, households, email });
    const response = await handler(rpcRequest({ body: JSON.stringify({ contractVersion: STORAGE_CONTRACT_VERSION, requestId: "request-expired", deadlineAt: 1, operation: "system.health", input: {} }) }));
    expect(response.status).toBe(408);
    expect(await response.json()).toEqual({ error: "deadline_exceeded" });
  });

  it("passes Better Auth routes to the gateway auth handler before RPC authentication", async () => {
    const authHandler = vi.fn(async () => Response.json({ ok: true }));
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 2048, ping: vi.fn(), recipes, tenant, plans, shopping, shares, apiKeys, ingestions, households, email, authHandler });
    const response = await handler(new Request("https://gateway.example.com/api/auth/dash/validate", { headers: { "x-tableplan-service-token": `Bearer ${token}` } }));
    expect(response.status).toBe(200);
    expect(authHandler).toHaveBeenCalledOnce();
  });

  it("does not expose Better Auth directly without the application service credential", async () => {
    const authHandler = vi.fn(async () => Response.json({ ok: true }));
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 2048, ping: vi.fn(), recipes, tenant, plans, shopping, shares, apiKeys, ingestions, households, email, authHandler });
    const response = await handler(new Request("https://gateway.example.com/api/auth/get-session"));
    expect(response.status).toBe(401);
    expect(authHandler).not.toHaveBeenCalled();
  });

  it("enforces the auth body ceiling for streamed requests without content-length", async () => {
    const authHandler = vi.fn(async () => Response.json({ ok: true }));
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 32, ping: vi.fn(), recipes, tenant, plans, shopping, shares, apiKeys, ingestions, households, email, authHandler });
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(33)); controller.close(); } });
    const request = new Request("https://gateway.example.com/api/auth/sign-up/email", { method: "POST", headers: { "x-tableplan-service-token": `Bearer ${token}` }, body, duplex: "half" } as RequestInit);
    const response = await handler(request);
    expect(response.status).toBe(413);
    expect(authHandler).not.toHaveBeenCalled();
  });

  it("rejects work above the configured in-flight ceiling", async () => {
    let release!: (value: { recipes: never[]; total: number; limit: number; offset: number }) => void;
    recipes.search.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 2048, maxInFlight: 1, ping: vi.fn(), recipes, tenant, plans, shopping, shares, apiKeys, ingestions, households, email, log: vi.fn() });
    const body = JSON.stringify({ contractVersion: STORAGE_CONTRACT_VERSION, requestId: "search-held", operation: "recipes.search", input: { search: {}, access: { userId: "user-1", householdId: "house-1" } } });
    const held = handler(rpcRequest({ body }));
    await vi.waitFor(() => expect(recipes.search).toHaveBeenCalled());
    const overloaded = await handler(rpcRequest({ body: body.replace("search-held", "search-overload") }));
    expect(overloaded.status).toBe(503);
    await expect(overloaded.json()).resolves.toEqual({ error: "gateway_overloaded" });
    release({ recipes: [], total: 0, limit: 24, offset: 0 });
    expect((await held).status).toBe(200);
  });
});

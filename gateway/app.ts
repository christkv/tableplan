import { createHash, timingSafeEqual } from "node:crypto";

import {
  gatewayRequestSchema,
  STORAGE_CONTRACT_VERSION,
  type GatewayHealthResponse,
} from "../src/storage/contract";
import type { MongoRecipeStore } from "./recipes";
import type { MongoTenantStore } from "./tenant";
import type { MongoPlanStore } from "./plans";
import type { MongoShoppingStore } from "./shopping";
import type { MongoShareStore } from "./shares";
import type { MongoApiKeyStore } from "./api-keys";
import type { MongoIngestionStore } from "./ingestions";
import type { MongoHouseholdStore } from "./households";
import type { MongoEmailStore } from "./email";
import { HouseholdInvitationError } from "../src/domain/households";
import { MealPlanCopyError } from "../src/domain/planning/meal-plans";

export interface GatewayDependencies {
  serviceToken: string;
  maxBodyBytes: number;
  maxInFlight?: number;
  ping(): Promise<void>;
  recipes: MongoRecipeStore;
  tenant: MongoTenantStore;
  plans: MongoPlanStore;
  shopping: MongoShoppingStore;
  shares: MongoShareStore;
  apiKeys: MongoApiKeyStore;
  ingestions: MongoIngestionStore;
  households: MongoHouseholdStore;
  email: MongoEmailStore;
  now?: () => number;
  authHandler?: (request: Request) => Promise<Response>;
  log?: (event: Record<string, unknown>) => void;
}

function authenticated(header: string | null, expectedToken: string): boolean {
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const expectedHash = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(suppliedHash, expectedHash) && supplied.length === expectedToken.length;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function storageError(error: unknown) {
  if (error instanceof HouseholdInvitationError || error instanceof MealPlanCopyError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  return { code: "storage_operation_failed", message: "Storage operation failed", retryable: true };
}

async function readBodyBytes(request: Request, maxBodyBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBodyBytes) throw new Error("request_too_large");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      throw new Error("request_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

async function readBody(request: Request, maxBodyBytes: number): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readBodyBytes(request, maxBodyBytes)));
}

export function createGatewayHandler(dependencies: GatewayDependencies) {
  const now = dependencies.now ?? (() => performance.now());
  const log = dependencies.log ?? ((event: Record<string, unknown>) => console.info(JSON.stringify(event)));
  let inFlight = 0;
  const handleRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/auth/") && dependencies.authHandler) {
      if (!authenticated(request.headers.get("x-tableplan-service-token"), dependencies.serviceToken)) return json({ error: "unauthorized" }, 401);
      if (request.method === "GET" || request.method === "HEAD") return dependencies.authHandler(request);
      try {
        const body = await readBodyBytes(request, dependencies.maxBodyBytes);
        return dependencies.authHandler(new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal }));
      } catch (error) {
        if (error instanceof Error && error.message === "request_too_large") return json({ error: "request_too_large" }, 413);
        throw error;
      }
    }
    if (request.method === "GET" && url.pathname === "/healthz") return json({ status: "ok" });
    if (request.method === "GET" && url.pathname === "/readyz") {
      try {
        await dependencies.ping();
        return json({ status: "ok" });
      } catch {
        return json({ status: "unavailable" }, 503);
      }
    }
    if (url.pathname !== "/v1/rpc") return new Response(null, { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    if (!authenticated(request.headers.get("authorization"), dependencies.serviceToken)) {
      return json({ error: "unauthorized" }, 401);
    }

    let raw: unknown;
    try {
      raw = await readBody(request, dependencies.maxBodyBytes);
    } catch (error) {
      return json({ error: error instanceof Error && error.message === "request_too_large" ? "request_too_large" : "invalid_json" }, error instanceof Error && error.message === "request_too_large" ? 413 : 400);
    }
    const parsed = gatewayRequestSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_request" }, 400);
    if (parsed.data.deadlineAt && parsed.data.deadlineAt < Date.now()) return json({ error: "deadline_exceeded" }, 408);

    const startedAt = now();
    let response: GatewayHealthResponse | Record<string, unknown>;
    try {
      let result: unknown;
      if (parsed.data.operation === "system.health") {
        await dependencies.ping();
        result = { status: "ok", backend: "mongodb-gateway", latencyMs: now() - startedAt };
      } else if (parsed.data.operation === "recipes.search") result = await dependencies.recipes.search(parsed.data.input.search, parsed.data.input.access);
      else if (parsed.data.operation === "recipes.facets") result = await dependencies.recipes.facets(parsed.data.input.search, parsed.data.input.access);
      else if (parsed.data.operation === "recipes.get") result = await dependencies.recipes.get(parsed.data.input.recipeId, parsed.data.input.access);
      else if (parsed.data.operation === "favourites.is") result = await dependencies.tenant.isFavorite(parsed.data.input.userId, parsed.data.input.recipeId);
      else if (parsed.data.operation === "favourites.set") { await dependencies.tenant.setFavorite(parsed.data.input.access, parsed.data.input.recipeId, parsed.data.input.favorite); result = null; }
      else if (parsed.data.operation === "favourites.list") result = await dependencies.tenant.listFavorites(parsed.data.input.access);
      else if (parsed.data.operation === "preferences.measurement.get") result = await dependencies.tenant.getMeasurementSystem(parsed.data.input.userId, parsed.data.input.householdId);
      else if (parsed.data.operation === "preferences.measurement.update") result = await dependencies.tenant.updateMeasurementSystem(parsed.data.input.userId, parsed.data.input.householdId, parsed.data.input.value);
      else if (parsed.data.operation === "preferences.slots.get") result = await dependencies.tenant.getSlots(parsed.data.input.access);
      else if (parsed.data.operation === "preferences.slots.update") result = await dependencies.tenant.updateSlots(parsed.data.input.access, parsed.data.input.ids, parsed.data.input.labels);
      else if (parsed.data.operation === "savedSearches.list") result = await dependencies.tenant.listSavedSearches(parsed.data.input.access);
      else if (parsed.data.operation === "savedSearches.create") result = await dependencies.tenant.createSavedSearch(parsed.data.input);
      else if (parsed.data.operation === "savedSearches.delete") { await dependencies.tenant.deleteSavedSearch(parsed.data.input.access, parsed.data.input.searchId); result = null; }
      else if (parsed.data.operation === "plans.getWeek") result = await dependencies.plans.get(parsed.data.input.access, parsed.data.input.startsOn, parsed.data.input.endsOn);
      else if (parsed.data.operation === "plans.getById") result = await dependencies.plans.getById(parsed.data.input.access, parsed.data.input.planId);
      else if (parsed.data.operation === "plans.getItemContext") result = await dependencies.plans.getItemContext(parsed.data.input.access, parsed.data.input.itemId, parsed.data.input.recipeId);
      else if (parsed.data.operation === "plans.ensure") result = await dependencies.plans.ensure(parsed.data.input);
      else if (parsed.data.operation === "plans.addItem") result = await dependencies.plans.addItem(parsed.data.input);
      else if (parsed.data.operation === "plans.removeItem") result = await dependencies.plans.removeItem(parsed.data.input.access, parsed.data.input.itemId);
      else if (parsed.data.operation === "plans.updateServings") result = await dependencies.plans.updateServings(parsed.data.input);
      else if (parsed.data.operation === "plans.copyWeek") result = await dependencies.plans.copyWeek(parsed.data.input);
      else if (parsed.data.operation === "shopping.generate") result = await dependencies.shopping.generate(parsed.data.input);
      else if (parsed.data.operation === "shopping.refreshPlan") result = await dependencies.shopping.refreshPlan(parsed.data.input.access, parsed.data.input.planId);
      else if (parsed.data.operation === "shopping.refreshRecipe") { await dependencies.shopping.refreshRecipe(parsed.data.input.access, parsed.data.input.recipeId); result = null; }
      else if (parsed.data.operation === "shopping.getLatest") result = await dependencies.shopping.getLatest(parsed.data.input.access, parsed.data.input.displaySystem);
      else if (parsed.data.operation === "shopping.getById") result = await dependencies.shopping.getById(parsed.data.input.access, parsed.data.input.listId, parsed.data.input.displaySystem);
      else if (parsed.data.operation === "shopping.getForPlan") result = await dependencies.shopping.getForPlan(parsed.data.input.access, parsed.data.input.planId, parsed.data.input.listId, parsed.data.input.displaySystem);
      else if (parsed.data.operation === "shopping.toggle") result = await dependencies.shopping.toggle(parsed.data.input.access, parsed.data.input.itemId, parsed.data.input.checked);
      else if (parsed.data.operation === "shares.create") result = await dependencies.shares.create(parsed.data.input);
      else if (parsed.data.operation === "shares.resolve") result = await dependencies.shares.resolve(parsed.data.input.token, parsed.data.input.expectedShareId);
      else if (parsed.data.operation === "shares.revoke") result = await dependencies.shares.revoke(parsed.data.input.access, parsed.data.input.listId, parsed.data.input.shareId);
      else if (parsed.data.operation === "shares.list") result = await dependencies.shares.list(parsed.data.input.access, parsed.data.input.listId);
      else if (parsed.data.operation === "shares.getPublicList") result = await dependencies.shares.getPublicList(parsed.data.input.share);
      else if (parsed.data.operation === "shares.togglePublic") result = await dependencies.shares.togglePublic(parsed.data.input.share, parsed.data.input.itemId, parsed.data.input.checked);
      else if (parsed.data.operation === "shares.touch") { await dependencies.shares.touch(parsed.data.input.shareId); result = null; }
      else if (parsed.data.operation === "apiKeys.create") result = await dependencies.apiKeys.create(parsed.data.input);
      else if (parsed.data.operation === "apiKeys.list") result = await dependencies.apiKeys.list(parsed.data.input.userId);
      else if (parsed.data.operation === "apiKeys.revoke") { await dependencies.apiKeys.revoke(parsed.data.input.userId, parsed.data.input.keyId); result = null; }
      else if (parsed.data.operation === "apiKeys.authenticate") result = await dependencies.apiKeys.authenticate(parsed.data.input.key);
      else if (parsed.data.operation === "ingestions.create") result = await dependencies.ingestions.create(parsed.data.input);
      else if (parsed.data.operation === "ingestions.attachArtifact") result = await dependencies.ingestions.attachArtifact(parsed.data.input);
      else if (parsed.data.operation === "ingestions.updateStatus") { await dependencies.ingestions.updateStatus(parsed.data.input.ingestionId, parsed.data.input.status, parsed.data.input.message, parsed.data.input.error); result = null; }
      else if (parsed.data.operation === "ingestions.saveDraft") result = await dependencies.ingestions.saveDraft(parsed.data.input.ingestionId, parsed.data.input.householdId, parsed.data.input.draft as never, parsed.data.input.provider, parsed.data.input.model);
      else if (parsed.data.operation === "ingestions.get") result = await dependencies.ingestions.get(parsed.data.input.ingestionId, parsed.data.input.access);
      else if (parsed.data.operation === "ingestions.getArtifact") result = await dependencies.ingestions.getArtifact(parsed.data.input.ingestionId);
      else if (parsed.data.operation === "ingredients.candidates") result = await dependencies.ingestions.candidates(parsed.data.input.query, parsed.data.input.limit);
      else if (parsed.data.operation === "ingestions.publish") result = await dependencies.ingestions.publish(parsed.data.input as never);
      else if (parsed.data.operation === "recipes.setVisibility") { await dependencies.ingestions.setVisibility(parsed.data.input.recipeId, parsed.data.input.access, parsed.data.input.visibility); result = null; }
      else if (parsed.data.operation === "recipes.updateOwned") { await dependencies.ingestions.updateOwned(parsed.data.input as never); result = null; }
      else if (parsed.data.operation === "households.ensureForUser") result = await dependencies.tenant.ensureUserHousehold(parsed.data.input.user);
      else if (parsed.data.operation === "users.getEmail") result = await dependencies.tenant.getUserEmail(parsed.data.input.userId);
      else if (parsed.data.operation === "households.overview") result = await dependencies.households.overview(parsed.data.input.householdId, parsed.data.input.userId);
      else if (parsed.data.operation === "households.switchDefault") { await dependencies.households.switchDefault(parsed.data.input.userId, parsed.data.input.householdId); result = null; }
      else if (parsed.data.operation === "invitations.create") result = await dependencies.households.createInvitation(parsed.data.input);
      else if (parsed.data.operation === "invitations.revoke") { await dependencies.households.revokeInvitation(parsed.data.input.householdId, parsed.data.input.userId, parsed.data.input.invitationId); result = null; }
      else if (parsed.data.operation === "invitations.resolve") result = await dependencies.households.resolveInvitation(parsed.data.input.token);
      else if (parsed.data.operation === "invitations.accept") { await dependencies.households.acceptInvitation(parsed.data.input.invitation as never, parsed.data.input.user); result = null; }
      else if (parsed.data.operation === "invitations.claimEmail") result = await dependencies.households.claimInvitationEmail(parsed.data.input.invitationId);
      else if (parsed.data.operation === "invitations.delivery") { await dependencies.households.updateInvitationDelivery(parsed.data.input.invitationId, parsed.data.input.status, parsed.data.input.details); result = null; }
      else if (parsed.data.operation === "email.create") result = await dependencies.email.create(parsed.data.input);
      else if (parsed.data.operation === "email.claim") result = await dependencies.email.claim(parsed.data.input.deliveryId);
      else if (parsed.data.operation === "email.update") { await dependencies.email.update(parsed.data.input.deliveryId, parsed.data.input.status, parsed.data.input.details); result = null; }
      else result = await dependencies.email.get(parsed.data.input.householdId, parsed.data.input.userId, parsed.data.input.deliveryId);
      response = {
        contractVersion: STORAGE_CONTRACT_VERSION,
        requestId: parsed.data.requestId,
        ok: true,
        result,
      };
    } catch (error) {
      response = {
        contractVersion: STORAGE_CONTRACT_VERSION,
        requestId: parsed.data.requestId,
        ok: false,
        error: storageError(error),
      };
    }
    log({ event: "gateway.rpc", operation: parsed.data.operation, requestId: parsed.data.requestId, ok: response.ok, durationMs: Math.max(0, now() - startedAt) });
    return json(response);
  };
  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/healthz" || pathname === "/readyz") return handleRequest(request);
    const limit = dependencies.maxInFlight ?? 100;
    if (inFlight >= limit) return Response.json({ error: "gateway_overloaded" }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "1" } });
    inFlight += 1;
    try { return await handleRequest(request); }
    finally { inFlight -= 1; }
  };
}

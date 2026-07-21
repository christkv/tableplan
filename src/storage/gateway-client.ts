import {
  gatewayRecipeFacetsResponseSchema,
  gatewayRecipeGetResponseSchema,
  gatewayRecipeSearchResponseSchema,
  gatewayBooleanResponseSchema,
  gatewayFavoritesResponseSchema,
  gatewayMeasurementResponseSchema,
  gatewaySavedSearchResponseSchema,
  gatewaySavedSearchesResponseSchema,
  gatewaySlotsResponseSchema,
  gatewayVoidResponseSchema,
  gatewayNullableStringResponseSchema,
  gatewayPlanContextResponseSchema,
  gatewayPlanCopyResponseSchema,
  gatewayPlanResponseSchema,
  gatewayShoppingResponseSchema,
  gatewayStringResponseSchema,
  gatewayCreatedShareResponseSchema,
  gatewayPublicShoppingResponseSchema,
  gatewayResolvedShareResponseSchema,
  gatewayShareViewsResponseSchema,
  gatewayHealthResponseSchema,
  gatewayCreatedApiKeyResponseSchema,
  gatewayApiKeysResponseSchema,
  gatewayApiKeyAuthenticationResponseSchema,
  gatewayRecipeDraftResponseSchema,
  gatewayRecipeIngestionResponseSchema,
  gatewayRecipeArtifactResponseSchema,
  gatewayIngredientCandidatesResponseSchema,
  gatewayHouseholdOverviewResponseSchema,
  gatewayCreatedInvitationResponseSchema,
  gatewayInvitationResponseSchema,
  gatewayInvitationEmailRecordResponseSchema,
  gatewayEmailProcessingResponseSchema,
  gatewayEmailDeliveryResponseSchema,
  STORAGE_CONTRACT_VERSION,
  type GatewayHealthRequest,
  type StorageClient,
  type StorageHealth,
} from "./contract";
import type { RecipeAccessContext, RecipeSearchInput } from "../domain/recipes";
import { HouseholdInvitationError } from "../domain/households";
import { MealPlanCopyError } from "../domain/planning/meal-plans";
import type { ResolvedShoppingShare } from "../domain/shopping-share";
import type { ZodType } from "zod";

type RpcResponse<T> = { requestId: string; ok: true; result: T } | { requestId: string; ok: false; error: { code: string; message: string; retryable: boolean } };

export interface MongoGatewayClientOptions {
  baseUrl: string;
  serviceToken: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

function validateGatewayUrl(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("MongoDB gateway URL must use HTTPS except during local development");
  }
  return url.toString().replace(/\/$/, "");
}

function unavailable(startedAt: number, errorCode: string): StorageHealth {
  return {
    status: "unavailable",
    backend: "mongodb-gateway",
    latencyMs: performance.now() - startedAt,
    errorCode,
  };
}

export class MongoGatewayStorageClient implements StorageClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: MongoGatewayClientOptions) {
    this.baseUrl = validateGatewayUrl(options.baseUrl);
    this.serviceToken = options.serviceToken.trim();
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.fetcher = options.fetcher ?? fetch;
    if (!this.serviceToken) throw new Error("MongoDB gateway service token is required");
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("MongoDB gateway timeout must be positive");
  }

  async health(): Promise<StorageHealth> {
    const startedAt = performance.now();
    const requestId = crypto.randomUUID();
    const request: GatewayHealthRequest = {
      contractVersion: STORAGE_CONTRACT_VERSION,
      requestId,
      deadlineAt: Date.now() + this.timeoutMs,
      operation: "system.health",
      input: {},
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(`${this.baseUrl}/v1/rpc`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.serviceToken}`,
          "content-type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) return unavailable(startedAt, `gateway_http_${response.status}`);

      const parsed = gatewayHealthResponseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.requestId !== requestId) return unavailable(startedAt, "gateway_invalid_response");
      if (!parsed.data.ok) return unavailable(startedAt, parsed.data.error.code);
      if (parsed.data.result.backend !== "mongodb-gateway") return unavailable(startedAt, "gateway_backend_mismatch");
      return {
        ...parsed.data.result,
        latencyMs: performance.now() - startedAt,
      };
    } catch (error) {
      return unavailable(startedAt, error instanceof DOMException && error.name === "AbortError" ? "gateway_timeout" : "gateway_unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async rpc<T>(operation: string, input: unknown, responseSchema: ZodType<RpcResponse<T>>, errorCode: string): Promise<T> {
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}/v1/rpc`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.serviceToken}`, "content-type": "application/json", "x-request-id": requestId },
        body: JSON.stringify({ contractVersion: STORAGE_CONTRACT_VERSION, requestId, deadlineAt: Date.now() + this.timeoutMs, operation, input }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${errorCode}: gateway HTTP ${response.status}`);
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.requestId !== requestId) throw new Error(`${errorCode}: invalid gateway response`);
      if (!parsed.data.ok) {
        if (operation.startsWith("households.") || operation.startsWith("invitations.")) throw new HouseholdInvitationError(parsed.data.error.code, parsed.data.error.message);
        if (operation === "plans.copyWeek" && (parsed.data.error.code === "source_empty" || parsed.data.error.code === "target_not_empty")) throw new MealPlanCopyError(parsed.data.error.code, parsed.data.error.message);
        throw new Error(`${parsed.data.error.code}: ${parsed.data.error.message}`);
      }
      return parsed.data.result as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  searchRecipes(input: RecipeSearchInput, access: RecipeAccessContext) {
    return this.rpc<Awaited<ReturnType<StorageClient["searchRecipes"]>>>("recipes.search", { search: input, access }, gatewayRecipeSearchResponseSchema, "recipe_search_failed");
  }

  listRecipeTagFacets(input: Pick<RecipeSearchInput, "query" | "ingredient" | "scope">, access: RecipeAccessContext) {
    return this.rpc<Awaited<ReturnType<StorageClient["listRecipeTagFacets"]>>>("recipes.facets", { search: input, access }, gatewayRecipeFacetsResponseSchema, "recipe_facets_failed");
  }

  getRecipe(recipeId: string, access: RecipeAccessContext) {
    return this.rpc<Awaited<ReturnType<StorageClient["getRecipe"]>>>("recipes.get", { recipeId, access }, gatewayRecipeGetResponseSchema, "recipe_get_failed");
  }

  isFavorite(userId: string, recipeId: string) { return this.rpc<boolean>("favourites.is", { userId, recipeId }, gatewayBooleanResponseSchema, "favourite_check_failed"); }
  async setFavorite(access: RecipeAccessContext, recipeId: string, favorite: boolean) { await this.rpc<null>("favourites.set", { access, recipeId, favorite }, gatewayVoidResponseSchema, "favourite_update_failed"); }
  listFavorites(access: RecipeAccessContext) { return this.rpc<Awaited<ReturnType<StorageClient["listFavorites"]>>>("favourites.list", { access }, gatewayFavoritesResponseSchema, "favourites_list_failed"); }
  getMeasurementSystem(userId: string, householdId: string) { return this.rpc<Awaited<ReturnType<StorageClient["getMeasurementSystem"]>>>("preferences.measurement.get", { userId, householdId }, gatewayMeasurementResponseSchema, "measurement_get_failed"); }
  updateMeasurementSystem(userId: string, householdId: string, value: unknown) { return this.rpc<Awaited<ReturnType<StorageClient["updateMeasurementSystem"]>>>("preferences.measurement.update", { userId, householdId, value }, gatewayMeasurementResponseSchema, "measurement_update_failed"); }
  getMealPlanSlots(access: RecipeAccessContext) { return this.rpc<Awaited<ReturnType<StorageClient["getMealPlanSlots"]>>>("preferences.slots.get", { access }, gatewaySlotsResponseSchema, "slots_get_failed"); }
  updateMealPlanSlots(access: RecipeAccessContext, ids: unknown[], labels: unknown[]) { return this.rpc<Awaited<ReturnType<StorageClient["updateMealPlanSlots"]>>>("preferences.slots.update", { access, ids, labels }, gatewaySlotsResponseSchema, "slots_update_failed"); }
  listSavedRecipeSearches(access: RecipeAccessContext) { return this.rpc<Awaited<ReturnType<StorageClient["listSavedRecipeSearches"]>>>("savedSearches.list", { access }, gatewaySavedSearchesResponseSchema, "saved_searches_list_failed"); }
  createSavedRecipeSearch(input: Parameters<StorageClient["createSavedRecipeSearch"]>[0]) { return this.rpc<Awaited<ReturnType<StorageClient["createSavedRecipeSearch"]>>>("savedSearches.create", input, gatewaySavedSearchResponseSchema, "saved_search_create_failed"); }
  async deleteSavedRecipeSearch(access: RecipeAccessContext, searchId: string) { await this.rpc<null>("savedSearches.delete", { access, searchId }, gatewayVoidResponseSchema, "saved_search_delete_failed"); }
  getMealPlan(access: RecipeAccessContext, startsOn: string, endsOn: string) { return this.rpc<Awaited<ReturnType<StorageClient["getMealPlan"]>>>("plans.getWeek", { access, startsOn, endsOn }, gatewayPlanResponseSchema, "plan_get_failed"); }
  getMealPlanById(access: RecipeAccessContext, planId: string) { return this.rpc<Awaited<ReturnType<StorageClient["getMealPlanById"]>>>("plans.getById", { access, planId }, gatewayPlanResponseSchema, "plan_get_failed"); }
  getMealPlanItemContext(access: RecipeAccessContext, itemId: string, recipeId: string) { return this.rpc<Awaited<ReturnType<StorageClient["getMealPlanItemContext"]>>>("plans.getItemContext", { access, itemId, recipeId }, gatewayPlanContextResponseSchema, "plan_item_get_failed"); }
  ensureMealPlan(input: Parameters<StorageClient["ensureMealPlan"]>[0]) { return this.rpc<string>("plans.ensure", input, gatewayStringResponseSchema, "plan_ensure_failed"); }
  addMealPlanItem(input: Parameters<StorageClient["addMealPlanItem"]>[0]) { return this.rpc<string>("plans.addItem", input, gatewayStringResponseSchema, "plan_item_add_failed"); }
  removeMealPlanItem(access: RecipeAccessContext, itemId: string) { return this.rpc<string | null>("plans.removeItem", { access, itemId }, gatewayNullableStringResponseSchema, "plan_item_remove_failed"); }
  updateMealPlanItemServings(input: Parameters<StorageClient["updateMealPlanItemServings"]>[0]) { return this.rpc<string>("plans.updateServings", input, gatewayStringResponseSchema, "plan_item_update_failed"); }
  copyMealPlanWeek(input: Parameters<StorageClient["copyMealPlanWeek"]>[0]) { return this.rpc<Awaited<ReturnType<StorageClient["copyMealPlanWeek"]>>>("plans.copyWeek", input, gatewayPlanCopyResponseSchema, "plan_copy_failed"); }
  generateShoppingList(input: Parameters<StorageClient["generateShoppingList"]>[0]) { return this.rpc<string>("shopping.generate", input, gatewayStringResponseSchema, "shopping_generate_failed"); }
  refreshShoppingListForPlan(access: RecipeAccessContext, planId: string) { return this.rpc<string | null>("shopping.refreshPlan", { access, planId }, gatewayNullableStringResponseSchema, "shopping_refresh_failed"); }
  async refreshShoppingListsForRecipe(access: RecipeAccessContext, recipeId: string) { await this.rpc<null>("shopping.refreshRecipe", { access, recipeId }, gatewayVoidResponseSchema, "shopping_refresh_failed"); }
  getLatestShoppingList(access: RecipeAccessContext, displaySystem?: Parameters<StorageClient["getLatestShoppingList"]>[1]) { return this.rpc<Awaited<ReturnType<StorageClient["getLatestShoppingList"]>>>("shopping.getLatest", { access, displaySystem }, gatewayShoppingResponseSchema, "shopping_get_failed"); }
  getShoppingListById(access: RecipeAccessContext, listId: string, displaySystem?: Parameters<StorageClient["getShoppingListById"]>[2]) { return this.rpc<Awaited<ReturnType<StorageClient["getShoppingListById"]>>>("shopping.getById", { access, listId, displaySystem }, gatewayShoppingResponseSchema, "shopping_get_failed"); }
  getShoppingListForPlan(access: RecipeAccessContext, planId: string, listId?: string, displaySystem?: Parameters<StorageClient["getShoppingListForPlan"]>[3]) { return this.rpc<Awaited<ReturnType<StorageClient["getShoppingListForPlan"]>>>("shopping.getForPlan", { access, planId, listId, displaySystem }, gatewayShoppingResponseSchema, "shopping_get_failed"); }
  toggleShoppingItem(access: RecipeAccessContext, itemId: string, checked: boolean) { return this.rpc<boolean>("shopping.toggle", { access, itemId, checked }, gatewayBooleanResponseSchema, "shopping_toggle_failed"); }
  createShoppingShare(input: Parameters<StorageClient["createShoppingShare"]>[0]) { return this.rpc<Awaited<ReturnType<StorageClient["createShoppingShare"]>>>("shares.create", input, gatewayCreatedShareResponseSchema, "share_create_failed"); }
  resolveShoppingShare(token: string, expectedShareId?: string) { return this.rpc<Awaited<ReturnType<StorageClient["resolveShoppingShare"]>>>("shares.resolve", { token, expectedShareId }, gatewayResolvedShareResponseSchema, "share_resolve_failed"); }
  revokeShoppingShare(access: RecipeAccessContext, listId: string, shareId: string) { return this.rpc<boolean>("shares.revoke", { access, listId, shareId }, gatewayBooleanResponseSchema, "share_revoke_failed"); }
  listShoppingShares(access: RecipeAccessContext, listId: string) { return this.rpc<Awaited<ReturnType<StorageClient["listShoppingShares"]>>>("shares.list", { access, listId }, gatewayShareViewsResponseSchema, "shares_list_failed"); }
  getPublicShoppingList(share: ResolvedShoppingShare) { return this.rpc<Awaited<ReturnType<StorageClient["getPublicShoppingList"]>>>("shares.getPublicList", { share }, gatewayPublicShoppingResponseSchema, "public_list_get_failed"); }
  togglePublicShoppingItem(share: ResolvedShoppingShare, itemId: string, checked: boolean) { return this.rpc<boolean>("shares.togglePublic", { share, itemId, checked }, gatewayBooleanResponseSchema, "public_list_toggle_failed"); }
  async touchShoppingShare(shareId: string) { await this.rpc<null>("shares.touch", { shareId }, gatewayVoidResponseSchema, "share_touch_failed"); }
  createApiKey(input: Parameters<StorageClient["createApiKey"]>[0]) { return this.rpc<Awaited<ReturnType<StorageClient["createApiKey"]>>>("apiKeys.create", input, gatewayCreatedApiKeyResponseSchema, "api_key_create_failed"); }
  listApiKeys(userId: string) { return this.rpc<Awaited<ReturnType<StorageClient["listApiKeys"]>>>("apiKeys.list", { userId }, gatewayApiKeysResponseSchema, "api_keys_list_failed"); }
  async revokeApiKey(userId: string, keyId: string) { await this.rpc<null>("apiKeys.revoke", { userId, keyId }, gatewayVoidResponseSchema, "api_key_revoke_failed"); }
  authenticateApiKey(key: string) { return this.rpc<Awaited<ReturnType<StorageClient["authenticateApiKey"]>>>("apiKeys.authenticate", { key }, gatewayApiKeyAuthenticationResponseSchema, "api_key_authentication_failed"); }
  createRecipeIngestion(input: Parameters<StorageClient["createRecipeIngestion"]>[0]) { return this.rpc<string>("ingestions.create", input, gatewayStringResponseSchema, "ingestion_create_failed"); }
  attachRecipeSourceArtifact(input: Parameters<StorageClient["attachRecipeSourceArtifact"]>[0]) { return this.rpc<string>("ingestions.attachArtifact", input, gatewayStringResponseSchema, "artifact_attach_failed"); }
  async updateRecipeIngestionStatus(ingestionId: string, status: Parameters<StorageClient["updateRecipeIngestionStatus"]>[1], message: string, error?: { code: string; message: string }) { await this.rpc<null>("ingestions.updateStatus", { ingestionId, status, message, error }, gatewayVoidResponseSchema, "ingestion_update_failed"); }
  saveRecipeIngestionDraft(ingestionId: string, householdId: string, draft: Parameters<StorageClient["saveRecipeIngestionDraft"]>[2], provider?: string, model?: string) { return this.rpc<Awaited<ReturnType<StorageClient["saveRecipeIngestionDraft"]>>>("ingestions.saveDraft", { ingestionId, householdId, draft, provider, model }, gatewayRecipeDraftResponseSchema, "draft_save_failed"); }
  getRecipeIngestion(ingestionId: string, access: RecipeAccessContext) { return this.rpc<Awaited<ReturnType<StorageClient["getRecipeIngestion"]>>>("ingestions.get", { ingestionId, access }, gatewayRecipeIngestionResponseSchema, "ingestion_get_failed"); }
  getRecipeSourceArtifact(ingestionId: string) { return this.rpc<Awaited<ReturnType<StorageClient["getRecipeSourceArtifact"]>>>("ingestions.getArtifact", { ingestionId }, gatewayRecipeArtifactResponseSchema, "artifact_get_failed"); }
  listIngredientCandidates(query: string, limit?: number) { return this.rpc<Awaited<ReturnType<StorageClient["listIngredientCandidates"]>>>("ingredients.candidates", { query, limit }, gatewayIngredientCandidatesResponseSchema, "ingredient_candidates_failed"); }
  publishRecipeDraft(input: Parameters<StorageClient["publishRecipeDraft"]>[0]) { return this.rpc<string>("ingestions.publish", input, gatewayStringResponseSchema, "recipe_publish_failed"); }
  async setRecipeVisibility(recipeId: string, access: RecipeAccessContext, visibility: "user_private" | "household") { await this.rpc<null>("recipes.setVisibility", { recipeId, access, visibility }, gatewayVoidResponseSchema, "recipe_visibility_failed"); }
  async updateOwnedRecipe(input: Parameters<StorageClient["updateOwnedRecipe"]>[0]) { await this.rpc<null>("recipes.updateOwned", input, gatewayVoidResponseSchema, "recipe_update_failed"); }
  ensureUserHousehold(user: { id: string; name: string }) { return this.rpc<string>("households.ensureForUser", { user }, gatewayStringResponseSchema, "household_ensure_failed"); }
  getUserEmail(userId: string) { return this.rpc<string | null>("users.getEmail", { userId }, gatewayNullableStringResponseSchema, "user_email_get_failed"); }
  getHouseholdOverview(householdId: string, userId: string) { return this.rpc<Awaited<ReturnType<StorageClient["getHouseholdOverview"]>>>("households.overview", { householdId, userId }, gatewayHouseholdOverviewResponseSchema, "household_get_failed"); }
  async switchDefaultHousehold(userId: string, householdId: string) { await this.rpc<null>("households.switchDefault", { userId, householdId }, gatewayVoidResponseSchema, "household_switch_failed"); }
  createHouseholdInvitationRecord(input: Parameters<StorageClient["createHouseholdInvitationRecord"]>[0]) { return this.rpc<Awaited<ReturnType<StorageClient["createHouseholdInvitationRecord"]>>>("invitations.create", input, gatewayCreatedInvitationResponseSchema, "invitation_create_failed"); }
  async revokeHouseholdInvitation(householdId: string, userId: string, invitationId: string) { await this.rpc<null>("invitations.revoke", { householdId, userId, invitationId }, gatewayVoidResponseSchema, "invitation_revoke_failed"); }
  resolveHouseholdInvitation(token: string) { return this.rpc<Awaited<ReturnType<StorageClient["resolveHouseholdInvitation"]>>>("invitations.resolve", { token }, gatewayInvitationResponseSchema, "invitation_resolve_failed"); }
  async acceptHouseholdInvitation(invitation: Parameters<StorageClient["acceptHouseholdInvitation"]>[0], user: { id: string; email: string }) { await this.rpc<null>("invitations.accept", { invitation, user }, gatewayVoidResponseSchema, "invitation_accept_failed"); }
  claimHouseholdInvitationEmail(invitationId: string) { return this.rpc<Awaited<ReturnType<StorageClient["claimHouseholdInvitationEmail"]>>>("invitations.claimEmail", { invitationId }, gatewayInvitationEmailRecordResponseSchema, "invitation_email_claim_failed"); }
  async updateHouseholdInvitationDelivery(invitationId: string, status: Parameters<StorageClient["updateHouseholdInvitationDelivery"]>[1], details?: { providerMessageId?: string; error?: string }) { await this.rpc<null>("invitations.delivery", { invitationId, status, details }, gatewayVoidResponseSchema, "invitation_delivery_update_failed"); }
  createEmailDelivery(input: Parameters<StorageClient["createEmailDelivery"]>[0]) { return this.rpc<string>("email.create", input, gatewayStringResponseSchema, "email_create_failed"); }
  claimEmailDelivery(deliveryId: string) { return this.rpc<Awaited<ReturnType<StorageClient["claimEmailDelivery"]>>>("email.claim", { deliveryId }, gatewayEmailProcessingResponseSchema, "email_claim_failed"); }
  async updateEmailDelivery(deliveryId: string, status: Parameters<StorageClient["updateEmailDelivery"]>[1], details?: { providerMessageId?: string; error?: string }) { await this.rpc<null>("email.update", { deliveryId, status, details }, gatewayVoidResponseSchema, "email_update_failed"); }
  getEmailDelivery(householdId: string, userId: string, deliveryId: string) { return this.rpc<Awaited<ReturnType<StorageClient["getEmailDelivery"]>>>("email.get", { householdId, userId, deliveryId }, gatewayEmailDeliveryResponseSchema, "email_get_failed"); }
}

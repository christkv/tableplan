import { z } from "zod";
import type { MealSlotDefinition } from "../domain/planning/slots";
import type { MealPlanItemContext, MealPlanView } from "../domain/planning/meal-plans";
import type { MeasurementSystem } from "../domain/quantity/types";
import type { SavedRecipeSearch } from "../domain/saved-searches";
import type { ShoppingListView } from "../domain/shopping";
import type { PublicShoppingList, ResolvedShoppingShare, ShoppingShareView } from "../domain/shopping-share";
import type { ApiKeyAuthentication, ApiKeyView, ApiScope } from "../domain/api-keys";
import type { PublishRecipeInput, RecipeDraft, RecipeIngestionStatus, RecipeIngestionView, RecipeInputKind } from "../ingestion/types";
import type { HouseholdInvitationEmailRecord, HouseholdInvitationView, HouseholdInviteRole, HouseholdOverview, HouseholdRelationship } from "../domain/households";

export const STORAGE_CONTRACT_VERSION = "2026-07-23.1" as const;

export const storageBackendSchema = z.literal("mongodb-gateway");
export type StorageBackend = z.infer<typeof storageBackendSchema>;

export const storageHealthSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  backend: storageBackendSchema,
  latencyMs: z.number().nonnegative(),
  errorCode: z.string().min(1).optional(),
});
export type StorageHealth = z.infer<typeof storageHealthSchema>;

export interface StorageClient {
  health(): Promise<StorageHealth>;
  searchRecipes(input: RecipeSearchInput, access: RecipeAccessContext): Promise<RecipeSearchResult>;
  listRecipeTagFacets(input: Pick<RecipeSearchInput, "query" | "ingredient" | "scope">, access: RecipeAccessContext): Promise<RecipeTagOption[]>;
  getRecipe(recipeId: string, access: RecipeAccessContext): Promise<RecipeDetail | null>;
  isFavorite(userId: string, recipeId: string): Promise<boolean>;
  setFavorite(access: RecipeAccessContext, recipeId: string, favorite: boolean): Promise<void>;
  listFavorites(access: RecipeAccessContext): Promise<RecipeSummary[]>;
  getMeasurementSystem(userId: string, householdId: string): Promise<MeasurementSystem>;
  updateMeasurementSystem(userId: string, householdId: string, value: unknown): Promise<MeasurementSystem>;
  getMealPlanSlots(access: RecipeAccessContext): Promise<MealSlotDefinition[]>;
  updateMealPlanSlots(access: RecipeAccessContext, ids: unknown[], labels: unknown[]): Promise<MealSlotDefinition[]>;
  listSavedRecipeSearches(access: RecipeAccessContext): Promise<SavedRecipeSearch[]>;
  createSavedRecipeSearch(input: { householdId: string; userId: string; name: unknown; filters: RecipeSearchInput }): Promise<SavedRecipeSearch>;
  deleteSavedRecipeSearch(access: RecipeAccessContext, searchId: string): Promise<void>;
  getMealPlan(access: RecipeAccessContext, startsOn: string, endsOn: string): Promise<MealPlanView | null>;
  getMealPlanById(access: RecipeAccessContext, planId: string): Promise<MealPlanView | null>;
  getMealPlanItemContext(access: RecipeAccessContext, itemId: string, recipeId: string): Promise<MealPlanItemContext | null>;
  ensureMealPlan(input: { householdId: string; startsOn: string; endsOn: string; timezone: string; userId: string }): Promise<string>;
  addMealPlanItem(input: { householdId: string; userId: string; planId: string; recipeId: string; date: string; slot: string; servings: number; notes?: string }): Promise<string>;
  removeMealPlanItem(access: RecipeAccessContext, itemId: string): Promise<string | null>;
  updateMealPlanItemServings(input: { householdId: string; userId: string; itemId: string; servings: number }): Promise<string>;
  copyMealPlanWeek(input: { householdId: string; userId: string; sourceStartsOn: string; targetStartsOn: string; timezone: string }): Promise<{ planId: string; itemCount: number }>;
  generateShoppingList(input: { householdId: string; planId: string; startsOn: string; endsOn: string; userId: string; measurementSystem: MeasurementSystem }): Promise<string>;
  refreshShoppingListForPlan(access: RecipeAccessContext, planId: string): Promise<string | null>;
  refreshShoppingListsForRecipe(access: RecipeAccessContext, recipeId: string): Promise<void>;
  getLatestShoppingList(access: RecipeAccessContext, displaySystem?: MeasurementSystem): Promise<ShoppingListView | null>;
  getShoppingListById(access: RecipeAccessContext, listId: string, displaySystem?: MeasurementSystem): Promise<ShoppingListView | null>;
  getShoppingListForPlan(access: RecipeAccessContext, planId: string, listId?: string, displaySystem?: MeasurementSystem): Promise<ShoppingListView | null>;
  toggleShoppingItem(access: RecipeAccessContext, itemId: string, checked: boolean): Promise<boolean>;
  createShoppingShare(input: { householdId: string; userId: string; listId: string; expiresInDays: number }): Promise<{ id: string; token: string; expiresAt: string }>;
  resolveShoppingShare(token: string, expectedShareId?: string): Promise<ResolvedShoppingShare | null>;
  revokeShoppingShare(access: RecipeAccessContext, listId: string, shareId: string): Promise<boolean>;
  listShoppingShares(access: RecipeAccessContext, listId: string): Promise<ShoppingShareView[]>;
  getPublicShoppingList(share: ResolvedShoppingShare): Promise<PublicShoppingList | null>;
  togglePublicShoppingItem(share: ResolvedShoppingShare, itemId: string, checked: boolean): Promise<boolean>;
  touchShoppingShare(shareId: string): Promise<void>;
  createApiKey(input: { userId: string; householdId: string; name: string; environment: "test" | "live"; scopes: ApiScope[]; expiresAt?: string }): Promise<{ id: string; key: string }>;
  listApiKeys(userId: string): Promise<ApiKeyView[]>;
  revokeApiKey(userId: string, keyId: string): Promise<void>;
  authenticateApiKey(key: string): Promise<ApiKeyAuthentication | null>;
  createRecipeIngestion(input: { userId: string; householdId: string; inputKind: RecipeInputKind; origin: "manual" | "paste" | "upload"; filename?: string; mediaType: string }): Promise<string>;
  attachRecipeSourceArtifact(input: { ingestionId: string; key: string; filename?: string; mediaType: string; byteSize: number; sha256: string }): Promise<string>;
  updateRecipeIngestionStatus(ingestionId: string, status: RecipeIngestionStatus, message: string, error?: { code: string; message: string }): Promise<void>;
  saveRecipeIngestionDraft(ingestionId: string, householdId: string, draft: RecipeDraft, provider?: string, model?: string): Promise<RecipeDraft>;
  getRecipeIngestion(ingestionId: string, access: RecipeAccessContext): Promise<RecipeIngestionView | null>;
  getRecipeSourceArtifact(ingestionId: string): Promise<{ key: string; filename: string | null; mediaType: string; householdId: string } | null>;
  listIngredientCandidates(query: string, limit?: number): Promise<Array<{ id: string; name: string; category: string | null }>>;
  publishRecipeDraft(input: PublishRecipeInput): Promise<string>;
  setRecipeVisibility(recipeId: string, access: RecipeAccessContext, visibility: "user_private" | "household"): Promise<void>;
  updateOwnedRecipe(input: { recipeId: string; access: RecipeAccessContext; draft: RecipeDraft }): Promise<void>;
  ensureUserHousehold(user: { id: string; name: string }): Promise<string>;
  getUserEmail(userId: string): Promise<string | null>;
  getHouseholdOverview(householdId: string, userId: string): Promise<HouseholdOverview>;
  switchDefaultHousehold(userId: string, householdId: string): Promise<void>;
  createHouseholdInvitationRecord(input: { householdId: string; invitedByUserId: string; email: string; relationship: HouseholdRelationship; role: HouseholdInviteRole }): Promise<{ id: string; email: string; expiresAt: string; token: string }>;
  revokeHouseholdInvitation(householdId: string, userId: string, invitationId: string): Promise<void>;
  resolveHouseholdInvitation(token: string): Promise<HouseholdInvitationView | null>;
  acceptHouseholdInvitation(invitation: HouseholdInvitationView, user: { id: string; email: string }): Promise<void>;
  claimHouseholdInvitationEmail(invitationId: string): Promise<HouseholdInvitationEmailRecord | null>;
  updateHouseholdInvitationDelivery(invitationId: string, status: "queued" | "sending" | "sent" | "failed", details?: { providerMessageId?: string; error?: string }): Promise<void>;
  createEmailDelivery(input: { householdId: string; userId: string; listId: string; shareId: string; recipientEmail: string }): Promise<string>;
  claimEmailDelivery(deliveryId: string): Promise<{ id: string; userId: string; householdId: string; shoppingListId: string; recipientEmail: string; status: string; expiresAt: string } | null>;
  updateEmailDelivery(deliveryId: string, status: "queued" | "sending" | "sent" | "failed", details?: { providerMessageId?: string; error?: string }): Promise<void>;
  getEmailDelivery(householdId: string, userId: string, deliveryId: string): Promise<{ id: string; shoppingListId: string; shareId: string; recipientEmail: string; status: string; attemptCount: number; lastError: string | null; queuedAt: string | null; sentAt: string | null; createdAt: string } | null>;
}

import type { RecipeAccessContext, RecipeDetail, RecipeSearchInput, RecipeSearchResult, RecipeSummary, RecipeTagOption } from "../domain/recipes";

const recipeAccessSchema = z.object({ userId: z.string().min(1), householdId: z.string().min(1) });
const recipeSearchInputSchema = z.object({
  query: z.string().max(500).optional(),
  ingredient: z.string().max(200).optional(),
  tags: z.array(z.string().min(1).max(100)).max(12).optional(),
  tagMatch: z.enum(["all", "any"]).optional(),
  tag: z.string().max(100).optional(),
  scope: z.enum(["all", "catalog", "mine", "household"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
}).strict();
export const recipeSummarySchema = z.object({
  id: z.string(), sourceId: z.string(), name: z.string(), description: z.string(), servings: z.number().nullable(),
  tags: z.array(z.string()), ingredients: z.array(z.string()), qualityFlags: z.array(z.string()),
  visibility: z.enum(["catalog", "user_private", "household"]), origin: z.enum(["dataset", "manual", "paste", "upload"]), isOwner: z.boolean(),
});
const recipeDetailSchema = recipeSummarySchema.extend({
  servingSize: z.string().nullable(),
  steps: z.array(z.object({ position: z.number(), instruction: z.string(), parseStatus: z.string() })),
  recipeIngredients: z.array(z.object({
    id: z.string(), position: z.number(), rawLine: z.string(), ingredient: z.string(), quantityMin: z.string().nullable(), quantityMax: z.string().nullable(),
    unitId: z.string().nullable(), preparation: z.string().nullable(), parseStatus: z.enum(["parsed", "partial", "unresolved"]),
  })),
});
const recipeSearchResultSchema = z.object({
  recipes: z.array(recipeSummarySchema),
  hasMore: z.boolean(),
  total: z.object({ value: z.number().int().nonnegative(), relation: z.enum(["exact", "lowerBound"]) }).nullable(),
  limit: z.number().int(),
  offset: z.number().int(),
});
const recipeTagOptionsSchema = z.array(z.object({ name: z.string(), recipeCount: z.number().int().nonnegative() }));
const recipeDraftSchema = z.object({
  title: z.string().max(240), description: z.string().max(4_000), servings: z.number().positive().max(1_000).nullable(), servingSize: z.string().max(120).nullable(),
  ingredients: z.array(z.string().min(1).max(1_000)).max(250), steps: z.array(z.string().min(1).max(5_000)).max(250),
  tags: z.array(z.string().min(1).max(100)).max(30), warnings: z.array(z.string().max(500)).max(50),
}).strict();
const householdInvitationRequestSchema = z.object({ id: z.string(), householdId: z.string(), householdName: z.string(), email: z.string(), relationship: z.enum(["spouse", "child", "flatmate", "other"]), role: z.literal("adult"), inviterName: z.string(), expiresAt: z.string(), createdAt: z.string(), deliveryStatus: z.string(), existingAccount: z.boolean() }).strict();

export const gatewayHealthRequestSchema = z.object({
  contractVersion: z.literal(STORAGE_CONTRACT_VERSION),
  requestId: z.string().min(1).max(128),
  deadlineAt: z.number().int().positive().optional(),
  operation: z.literal("system.health"),
  input: z.object({}).strict(),
});
export type GatewayHealthRequest = z.infer<typeof gatewayHealthRequestSchema>;

const requestBase = { contractVersion: z.literal(STORAGE_CONTRACT_VERSION), requestId: z.string().min(1).max(128), deadlineAt: z.number().int().positive().optional() };
const unknownArray = z.array(z.unknown()).max(20);
export const gatewayRequestSchema = z.discriminatedUnion("operation", [
  gatewayHealthRequestSchema,
  z.object({ ...requestBase, operation: z.literal("recipes.search"), input: z.object({ search: recipeSearchInputSchema, access: recipeAccessSchema }) }),
  z.object({ ...requestBase, operation: z.literal("recipes.facets"), input: z.object({ search: recipeSearchInputSchema.pick({ query: true, ingredient: true, scope: true }), access: recipeAccessSchema }) }),
  z.object({ ...requestBase, operation: z.literal("recipes.get"), input: z.object({ recipeId: z.string().min(1).max(200), access: recipeAccessSchema }) }),
  z.object({ ...requestBase, operation: z.literal("favourites.is"), input: z.object({ userId: z.string().min(1), recipeId: z.string().min(1) }) }),
  z.object({ ...requestBase, operation: z.literal("favourites.set"), input: z.object({ access: recipeAccessSchema, recipeId: z.string().min(1), favorite: z.boolean() }) }),
  z.object({ ...requestBase, operation: z.literal("favourites.list"), input: z.object({ access: recipeAccessSchema }) }),
  z.object({ ...requestBase, operation: z.literal("preferences.measurement.get"), input: z.object({ userId: z.string().min(1), householdId: z.string().min(1) }) }),
  z.object({ ...requestBase, operation: z.literal("preferences.measurement.update"), input: z.object({ userId: z.string().min(1), householdId: z.string().min(1), value: z.unknown() }) }),
  z.object({ ...requestBase, operation: z.literal("preferences.slots.get"), input: z.object({ access: recipeAccessSchema }) }),
  z.object({ ...requestBase, operation: z.literal("preferences.slots.update"), input: z.object({ access: recipeAccessSchema, ids: unknownArray, labels: unknownArray }) }),
  z.object({ ...requestBase, operation: z.literal("savedSearches.list"), input: z.object({ access: recipeAccessSchema }) }),
  z.object({ ...requestBase, operation: z.literal("savedSearches.create"), input: z.object({ householdId: z.string().min(1), userId: z.string().min(1), name: z.unknown(), filters: recipeSearchInputSchema }) }),
  z.object({ ...requestBase, operation: z.literal("savedSearches.delete"), input: z.object({ access: recipeAccessSchema, searchId: z.string().min(1) }) }),
  z.object({ ...requestBase, operation: z.literal("plans.getWeek"), input: z.object({ access: recipeAccessSchema, startsOn: z.string(), endsOn: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("plans.getById"), input: z.object({ access: recipeAccessSchema, planId: z.string().min(1) }) }),
  z.object({ ...requestBase, operation: z.literal("plans.getItemContext"), input: z.object({ access: recipeAccessSchema, itemId: z.string(), recipeId: z.string().min(1) }) }),
  z.object({ ...requestBase, operation: z.literal("plans.ensure"), input: z.object({ householdId: z.string(), startsOn: z.string(), endsOn: z.string(), timezone: z.string(), userId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("plans.addItem"), input: z.object({ householdId: z.string(), userId: z.string(), planId: z.string(), recipeId: z.string(), date: z.string(), slot: z.string(), servings: z.number(), notes: z.string().optional() }) }),
  z.object({ ...requestBase, operation: z.literal("plans.removeItem"), input: z.object({ access: recipeAccessSchema, itemId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("plans.updateServings"), input: z.object({ householdId: z.string(), userId: z.string(), itemId: z.string(), servings: z.number() }) }),
  z.object({ ...requestBase, operation: z.literal("plans.copyWeek"), input: z.object({ householdId: z.string(), userId: z.string(), sourceStartsOn: z.string(), targetStartsOn: z.string(), timezone: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("shopping.generate"), input: z.object({ householdId: z.string(), planId: z.string(), startsOn: z.string(), endsOn: z.string(), userId: z.string(), measurementSystem: z.enum(["original", "us", "metric"]) }) }),
  z.object({ ...requestBase, operation: z.literal("shopping.refreshPlan"), input: z.object({ access: recipeAccessSchema, planId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("shopping.refreshRecipe"), input: z.object({ access: recipeAccessSchema, recipeId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("shopping.getLatest"), input: z.object({ access: recipeAccessSchema, displaySystem: z.enum(["original", "us", "metric"]).optional() }) }),
  z.object({ ...requestBase, operation: z.literal("shopping.getById"), input: z.object({ access: recipeAccessSchema, listId: z.string(), displaySystem: z.enum(["original", "us", "metric"]).optional() }) }),
  z.object({ ...requestBase, operation: z.literal("shopping.getForPlan"), input: z.object({ access: recipeAccessSchema, planId: z.string(), listId: z.string().optional(), displaySystem: z.enum(["original", "us", "metric"]).optional() }) }),
  z.object({ ...requestBase, operation: z.literal("shopping.toggle"), input: z.object({ access: recipeAccessSchema, itemId: z.string(), checked: z.boolean() }) }),
  z.object({ ...requestBase, operation: z.literal("shares.create"), input: z.object({ householdId: z.string(), userId: z.string(), listId: z.string(), expiresInDays: z.number().int() }) }),
  z.object({ ...requestBase, operation: z.literal("shares.resolve"), input: z.object({ token: z.string().max(256), expectedShareId: z.string().optional() }) }),
  z.object({ ...requestBase, operation: z.literal("shares.revoke"), input: z.object({ access: recipeAccessSchema, listId: z.string(), shareId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("shares.list"), input: z.object({ access: recipeAccessSchema, listId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("shares.getPublicList"), input: z.object({ share: z.object({ id: z.string(), listId: z.string(), householdId: z.string(), expiresAt: z.string() }) }) }),
  z.object({ ...requestBase, operation: z.literal("shares.togglePublic"), input: z.object({ share: z.object({ id: z.string(), listId: z.string(), householdId: z.string(), expiresAt: z.string() }), itemId: z.string(), checked: z.boolean() }) }),
  z.object({ ...requestBase, operation: z.literal("shares.touch"), input: z.object({ shareId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("apiKeys.create"), input: z.object({ userId: z.string(), householdId: z.string(), name: z.string().min(1).max(100), environment: z.enum(["test", "live"]), scopes: z.array(z.enum(["recipes:read", "recipes:write", "plans:read", "plans:write", "shopping:read", "shopping:write", "household:read", "admin:import"])), expiresAt: z.string().optional() }) }),
  z.object({ ...requestBase, operation: z.literal("apiKeys.list"), input: z.object({ userId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("apiKeys.revoke"), input: z.object({ userId: z.string(), keyId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("apiKeys.authenticate"), input: z.object({ key: z.string().min(1).max(512) }) }),
  z.object({ ...requestBase, operation: z.literal("ingestions.create"), input: z.object({ userId: z.string(), householdId: z.string(), inputKind: z.enum(["text", "image", "document"]), origin: z.enum(["manual", "paste", "upload"]), filename: z.string().optional(), mediaType: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("ingestions.attachArtifact"), input: z.object({ ingestionId: z.string(), key: z.string(), filename: z.string().optional(), mediaType: z.string(), byteSize: z.number().int().nonnegative(), sha256: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("ingestions.updateStatus"), input: z.object({ ingestionId: z.string(), status: z.enum(["queued", "extracting", "review_ready", "publishing", "published", "failed", "cancelled"]), message: z.string(), error: z.object({ code: z.string(), message: z.string() }).optional() }) }),
  z.object({ ...requestBase, operation: z.literal("ingestions.saveDraft"), input: z.object({ ingestionId: z.string(), householdId: z.string(), draft: recipeDraftSchema, provider: z.string().optional(), model: z.string().optional() }) }),
  z.object({ ...requestBase, operation: z.literal("ingestions.get"), input: z.object({ ingestionId: z.string(), access: recipeAccessSchema }) }),
  z.object({ ...requestBase, operation: z.literal("ingestions.getArtifact"), input: z.object({ ingestionId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("ingredients.candidates"), input: z.object({ query: z.string(), limit: z.number().int().min(1).max(50).optional() }) }),
  z.object({ ...requestBase, operation: z.literal("ingestions.publish"), input: z.object({ ingestionId: z.string(), userId: z.string(), householdId: z.string(), visibility: z.enum(["user_private", "household"]), draft: recipeDraftSchema, ingredientSelections: z.array(z.object({ position: z.number().int().nonnegative(), ingredientId: z.string().nullable(), rememberAlias: z.boolean() })).max(250) }) }),
  z.object({ ...requestBase, operation: z.literal("recipes.setVisibility"), input: z.object({ recipeId: z.string(), access: recipeAccessSchema, visibility: z.enum(["user_private", "household"]) }) }),
  z.object({ ...requestBase, operation: z.literal("recipes.updateOwned"), input: z.object({ recipeId: z.string(), access: recipeAccessSchema, draft: recipeDraftSchema }) }),
  z.object({ ...requestBase, operation: z.literal("households.ensureForUser"), input: z.object({ user: z.object({ id: z.string(), name: z.string() }) }) }),
  z.object({ ...requestBase, operation: z.literal("users.getEmail"), input: z.object({ userId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("households.overview"), input: z.object({ householdId: z.string(), userId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("households.switchDefault"), input: z.object({ userId: z.string(), householdId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("invitations.create"), input: z.object({ householdId: z.string(), invitedByUserId: z.string(), email: z.string(), relationship: z.enum(["spouse", "child", "flatmate", "other"]), role: z.literal("adult") }) }),
  z.object({ ...requestBase, operation: z.literal("invitations.revoke"), input: z.object({ householdId: z.string(), userId: z.string(), invitationId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("invitations.resolve"), input: z.object({ token: z.string().max(256) }) }),
  z.object({ ...requestBase, operation: z.literal("invitations.accept"), input: z.object({ invitation: householdInvitationRequestSchema, user: z.object({ id: z.string(), email: z.string() }) }) }),
  z.object({ ...requestBase, operation: z.literal("invitations.claimEmail"), input: z.object({ invitationId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("invitations.delivery"), input: z.object({ invitationId: z.string(), status: z.enum(["queued", "sending", "sent", "failed"]), details: z.object({ providerMessageId: z.string().optional(), error: z.string().optional() }).optional() }) }),
  z.object({ ...requestBase, operation: z.literal("email.create"), input: z.object({ householdId: z.string(), userId: z.string(), listId: z.string(), shareId: z.string(), recipientEmail: z.string().email().max(254) }) }),
  z.object({ ...requestBase, operation: z.literal("email.claim"), input: z.object({ deliveryId: z.string() }) }),
  z.object({ ...requestBase, operation: z.literal("email.update"), input: z.object({ deliveryId: z.string(), status: z.enum(["queued", "sending", "sent", "failed"]), details: z.object({ providerMessageId: z.string().optional(), error: z.string().optional() }).optional() }) }),
  z.object({ ...requestBase, operation: z.literal("email.get"), input: z.object({ householdId: z.string(), userId: z.string(), deliveryId: z.string() }) }),
]);
export type GatewayRequest = z.infer<typeof gatewayRequestSchema>;

const gatewayErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});

export const gatewayHealthResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    contractVersion: z.literal(STORAGE_CONTRACT_VERSION),
    requestId: z.string().min(1),
    ok: z.literal(true),
    result: storageHealthSchema,
  }),
  z.object({
    contractVersion: z.literal(STORAGE_CONTRACT_VERSION),
    requestId: z.string().min(1),
    ok: z.literal(false),
    error: gatewayErrorSchema,
  }),
]);
export type GatewayHealthResponse = z.infer<typeof gatewayHealthResponseSchema>;

export const gatewayRecipeSearchResponseSchema = gatewayHealthResponseSchema.options[0].omit({ result: true }).extend({ result: recipeSearchResultSchema }).or(gatewayHealthResponseSchema.options[1]);
export const gatewayRecipeFacetsResponseSchema = gatewayHealthResponseSchema.options[0].omit({ result: true }).extend({ result: recipeTagOptionsSchema }).or(gatewayHealthResponseSchema.options[1]);
export const gatewayRecipeGetResponseSchema = gatewayHealthResponseSchema.options[0].omit({ result: true }).extend({ result: recipeDetailSchema.nullable() }).or(gatewayHealthResponseSchema.options[1]);
const measurementSchema = z.enum(["original", "us", "metric"]);
const slotSchema = z.object({ id: z.string(), label: z.string() });
const savedSearchSchema = z.object({ id: z.string(), name: z.string(), query: z.string(), ingredient: z.string(), tags: z.array(z.string()), tagMatch: z.enum(["all", "any"]), scope: z.enum(["all", "catalog", "mine", "household"]), createdAt: z.string(), updatedAt: z.string() });
const responseWith = <T extends z.ZodType>(result: T) => gatewayHealthResponseSchema.options[0].omit({ result: true }).extend({ result }).or(gatewayHealthResponseSchema.options[1]);
export const gatewayBooleanResponseSchema = responseWith(z.boolean());
export const gatewayVoidResponseSchema = responseWith(z.null());
export const gatewayFavoritesResponseSchema = responseWith(z.array(recipeSummarySchema));
export const gatewayMeasurementResponseSchema = responseWith(measurementSchema);
export const gatewaySlotsResponseSchema = responseWith(z.array(slotSchema));
export const gatewaySavedSearchResponseSchema = responseWith(savedSearchSchema);
export const gatewaySavedSearchesResponseSchema = responseWith(z.array(savedSearchSchema));
const planItemSchema = z.object({ id: z.string(), recipeId: z.string(), recipeName: z.string(), plannedDate: z.string(), mealSlot: z.string(), servings: z.number(), notes: z.string().nullable() });
const planSchema = z.object({ id: z.string(), name: z.string(), startsOn: z.string(), endsOn: z.string(), items: z.array(planItemSchema) });
const planContextSchema = z.object({ itemId: z.string(), planId: z.string(), planName: z.string(), startsOn: z.string(), endsOn: z.string(), recipeId: z.string(), plannedDate: z.string(), mealSlot: z.string(), servings: z.number() });
const shoppingSchema = z.object({ id: z.string(), name: z.string(), measurementSystem: measurementSchema, generatedAt: z.string(), updatedAt: z.string(), plan: z.object({ id: z.string(), name: z.string(), startsOn: z.string(), endsOn: z.string(), mealCount: z.number() }).nullable(), items: z.array(z.object({ id: z.string(), name: z.string(), quantityMin: z.string().nullable(), quantityMax: z.string().nullable(), unitId: z.string().nullable(), checked: z.boolean(), unresolved: z.boolean(), sources: z.array(z.object({ recipeId: z.string(), recipeName: z.string(), rawLine: z.string() })) })) });
export const gatewayStringResponseSchema = responseWith(z.string());
export const gatewayNullableStringResponseSchema = responseWith(z.string().nullable());
export const gatewayPlanResponseSchema = responseWith(planSchema.nullable());
export const gatewayPlanContextResponseSchema = responseWith(planContextSchema.nullable());
export const gatewayPlanCopyResponseSchema = responseWith(z.object({ planId: z.string(), itemCount: z.number().int() }));
export const gatewayShoppingResponseSchema = responseWith(shoppingSchema.nullable());
const resolvedShareSchema = z.object({ id: z.string(), listId: z.string(), householdId: z.string(), expiresAt: z.string() });
const shareViewSchema = z.object({ id: z.string(), tokenPrefix: z.string(), expiresAt: z.string(), revokedAt: z.string().nullable(), lastAccessedAt: z.string().nullable(), createdAt: z.string() });
const publicShoppingSchema = shoppingSchema.omit({ generatedAt: true }).extend({ plan: z.object({ name: z.string(), startsOn: z.string(), endsOn: z.string() }).nullable() });
export const gatewayCreatedShareResponseSchema = responseWith(z.object({ id: z.string(), token: z.string(), expiresAt: z.string() }));
export const gatewayResolvedShareResponseSchema = responseWith(resolvedShareSchema.nullable());
export const gatewayShareViewsResponseSchema = responseWith(z.array(shareViewSchema));
export const gatewayPublicShoppingResponseSchema = responseWith(publicShoppingSchema.nullable());
const apiScopeSchema = z.enum(["recipes:read", "recipes:write", "plans:read", "plans:write", "shopping:read", "shopping:write", "household:read", "admin:import"]);
const apiKeyViewSchema = z.object({ id: z.string(), name: z.string(), prefix: z.string(), scopes: z.array(apiScopeSchema), expiresAt: z.string().nullable(), lastUsedAt: z.string().nullable(), revokedAt: z.string().nullable(), createdAt: z.string() });
export const gatewayCreatedApiKeyResponseSchema = responseWith(z.object({ id: z.string(), key: z.string() }));
export const gatewayApiKeysResponseSchema = responseWith(z.array(apiKeyViewSchema));
export const gatewayApiKeyAuthenticationResponseSchema = responseWith(z.object({ id: z.string(), userId: z.string(), householdId: z.string(), scopes: z.array(apiScopeSchema) }).nullable());
const ingredientReviewSchema = z.object({ position: z.number().int(), rawLine: z.string(), parsedName: z.string(), ingredientId: z.string().nullable(), mappingStatus: z.enum(["mapped", "unmapped", "confirmed"]), mappingConfidence: z.number(), rememberAlias: z.boolean() });
const recipeIngestionSchema = z.object({ id: z.string(), userId: z.string(), householdId: z.string(), inputKind: z.enum(["text", "image", "document"]), origin: z.enum(["manual", "paste", "upload"]), status: z.enum(["queued", "extracting", "review_ready", "publishing", "published", "failed", "cancelled"]), filename: z.string().nullable(), mediaType: z.string().nullable(), recipeId: z.string().nullable(), progressMessage: z.string(), errorCode: z.string().nullable(), errorMessage: z.string().nullable(), draft: recipeDraftSchema.nullable(), ingredientReviews: z.array(ingredientReviewSchema) });
export const gatewayRecipeDraftResponseSchema = responseWith(recipeDraftSchema);
export const gatewayRecipeIngestionResponseSchema = responseWith(recipeIngestionSchema.nullable());
export const gatewayRecipeArtifactResponseSchema = responseWith(z.object({ key: z.string(), filename: z.string().nullable(), mediaType: z.string(), householdId: z.string() }).nullable());
export const gatewayIngredientCandidatesResponseSchema = responseWith(z.array(z.object({ id: z.string(), name: z.string(), category: z.string().nullable() })));
const relationshipSchema = z.enum(["spouse", "child", "flatmate", "other"]);
const roleSchema = z.enum(["owner", "adult", "viewer"]);
const invitationViewSchema = z.object({ id: z.string(), householdId: z.string(), householdName: z.string(), email: z.string(), relationship: relationshipSchema, role: z.literal("adult"), inviterName: z.string(), expiresAt: z.string(), createdAt: z.string(), deliveryStatus: z.string(), existingAccount: z.boolean() });
const householdOverviewSchema = z.object({ household: z.object({ id: z.string(), name: z.string() }), currentRole: roleSchema, availableHouseholds: z.array(z.object({ id: z.string(), name: z.string(), role: roleSchema })), members: z.array(z.object({ userId: z.string(), name: z.string(), email: z.string(), role: roleSchema, relationship: relationshipSchema, joinedAt: z.string() })), invitations: z.array(z.object({ id: z.string(), email: z.string(), relationship: relationshipSchema, role: z.literal("adult"), expiresAt: z.string(), deliveryStatus: z.string(), createdAt: z.string(), expired: z.boolean() })) });
export const gatewayHouseholdOverviewResponseSchema = responseWith(householdOverviewSchema);
export const gatewayCreatedInvitationResponseSchema = responseWith(z.object({ id: z.string(), email: z.string(), expiresAt: z.string(), token: z.string() }));
export const gatewayInvitationResponseSchema = responseWith(invitationViewSchema.nullable());
export const gatewayInvitationEmailRecordResponseSchema = responseWith(z.object({ id: z.string(), email: z.string(), relationship: z.string(), expiresAt: z.string(), deliveryStatus: z.string(), householdName: z.string(), inviterName: z.string() }).nullable());
export const gatewayEmailProcessingResponseSchema = responseWith(z.object({ id: z.string(), userId: z.string(), householdId: z.string(), shoppingListId: z.string(), recipientEmail: z.string(), status: z.string(), expiresAt: z.string() }).nullable());
export const gatewayEmailDeliveryResponseSchema = responseWith(z.object({ id: z.string(), shoppingListId: z.string(), shareId: z.string(), recipientEmail: z.string(), status: z.string(), attemptCount: z.number().int(), lastError: z.string().nullable(), queuedAt: z.string().nullable(), sentAt: z.string().nullable(), createdAt: z.string() }).nullable());

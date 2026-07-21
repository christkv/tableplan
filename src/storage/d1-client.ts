import { getRecipe, listRecipeTagFacets, searchRecipes } from "../db/recipes";
import { isFavorite, listFavorites, setFavorite } from "../db/favorites";
import { getMealPlanSlots, getMeasurementSystem, updateMealPlanSlots, updateMeasurementSystem } from "../db/preferences";
import { createSavedRecipeSearch, deleteSavedRecipeSearch, listSavedRecipeSearches } from "../db/saved-searches";
import { addMealPlanItem, copyMealPlanWeek, ensureMealPlan, getMealPlan, getMealPlanById, getMealPlanItemContext, removeMealPlanItem, updateMealPlanItemServings } from "../db/planning";
import { generateShoppingList, getLatestShoppingList, getShoppingListById, getShoppingListForPlan, refreshShoppingListForPlan, refreshShoppingListsForRecipe, toggleShoppingItem } from "../db/shopping";
import { createShoppingShare, getPublicShoppingList, listShoppingShares, resolveShoppingShare, revokeShoppingShare, togglePublicShoppingItem } from "../sharing/shopping-share";
import type { ResolvedShoppingShare } from "../domain/shopping-share";
import type { RecipeAccessContext, RecipeSearchInput } from "../domain/recipes";
import type { StorageClient, StorageHealth } from "./contract";
import { authenticateApiKeyWithD1, createApiKey, listApiKeys, revokeApiKey } from "../auth/api-keys";
import { attachSourceArtifact, createRecipeIngestion, getRecipeIngestion, listIngredientCandidates, publishRecipeDraft, saveIngestionDraft, setRecipeVisibility, updateIngestionStatus, updateOwnedRecipe } from "../ingestion/service";
import { d1AcceptInvitation, d1ClaimInvitationEmail, d1CreateInvitation, d1HouseholdOverview, d1InvitationDelivery, d1ResolveInvitation, d1RevokeInvitation, d1SwitchHousehold } from "./d1-households";
import { d1ClaimEmail, d1CreateEmailDelivery, d1GetEmail, d1UpdateEmail } from "./d1-email";

export class D1StorageClient implements StorageClient {
  constructor(private readonly database: D1Database) {}

  async health(): Promise<StorageHealth> {
    const startedAt = performance.now();
    try {
      await this.database.prepare("SELECT 1 AS ok").first();
      return {
        status: "ok",
        backend: "d1",
        latencyMs: performance.now() - startedAt,
      };
    } catch {
      return {
        status: "unavailable",
        backend: "d1",
        latencyMs: performance.now() - startedAt,
        errorCode: "d1_unavailable",
      };
    }
  }

  searchRecipes(input: RecipeSearchInput, access: RecipeAccessContext) {
    return searchRecipes(this.database, input, access);
  }

  listRecipeTagFacets(input: Pick<RecipeSearchInput, "query" | "ingredient" | "scope">, access: RecipeAccessContext) {
    return listRecipeTagFacets(this.database, input, access);
  }

  getRecipe(recipeId: string, access: RecipeAccessContext) {
    return getRecipe(this.database, recipeId, access);
  }

  isFavorite(userId: string, recipeId: string) { return isFavorite(this.database, userId, recipeId); }
  async setFavorite(access: RecipeAccessContext, recipeId: string, favorite: boolean) { await setFavorite(this.database, access, recipeId, favorite); }
  listFavorites(access: RecipeAccessContext) { return listFavorites(this.database, access); }
  getMeasurementSystem(userId: string, householdId: string) { return getMeasurementSystem(this.database, userId, householdId); }
  updateMeasurementSystem(userId: string, householdId: string, value: unknown) { return updateMeasurementSystem(this.database, userId, householdId, value); }
  getMealPlanSlots(access: RecipeAccessContext) { return getMealPlanSlots(this.database, access.householdId); }
  updateMealPlanSlots(access: RecipeAccessContext, ids: unknown[], labels: unknown[]) { return updateMealPlanSlots(this.database, access.householdId, ids, labels); }
  listSavedRecipeSearches(access: RecipeAccessContext) { return listSavedRecipeSearches(this.database, access.householdId); }
  createSavedRecipeSearch(input: Parameters<StorageClient["createSavedRecipeSearch"]>[0]) { return createSavedRecipeSearch(this.database, input); }
  deleteSavedRecipeSearch(access: RecipeAccessContext, searchId: string) { return deleteSavedRecipeSearch(this.database, access.householdId, searchId); }
  getMealPlan(access: RecipeAccessContext, startsOn: string, endsOn: string) { return getMealPlan(this.database, access.householdId, startsOn, endsOn); }
  getMealPlanById(access: RecipeAccessContext, planId: string) { return getMealPlanById(this.database, access.householdId, planId); }
  getMealPlanItemContext(access: RecipeAccessContext, itemId: string, recipeId: string) { return getMealPlanItemContext(this.database, access.householdId, itemId, recipeId); }
  ensureMealPlan(input: Parameters<StorageClient["ensureMealPlan"]>[0]) { return ensureMealPlan(this.database, input); }
  addMealPlanItem(input: Parameters<StorageClient["addMealPlanItem"]>[0]) { return addMealPlanItem(this.database, input); }
  removeMealPlanItem(access: RecipeAccessContext, itemId: string) { return removeMealPlanItem(this.database, access.householdId, itemId); }
  updateMealPlanItemServings(input: Parameters<StorageClient["updateMealPlanItemServings"]>[0]) { return updateMealPlanItemServings(this.database, input); }
  copyMealPlanWeek(input: Parameters<StorageClient["copyMealPlanWeek"]>[0]) { return copyMealPlanWeek(this.database, input); }
  generateShoppingList(input: Parameters<StorageClient["generateShoppingList"]>[0]) { return generateShoppingList(this.database, input); }
  refreshShoppingListForPlan(access: RecipeAccessContext, planId: string) { return refreshShoppingListForPlan(this.database, access.householdId, planId); }
  async refreshShoppingListsForRecipe(access: RecipeAccessContext, recipeId: string) { await refreshShoppingListsForRecipe(this.database, access.householdId, recipeId); }
  getLatestShoppingList(access: RecipeAccessContext, displaySystem?: Parameters<StorageClient["getLatestShoppingList"]>[1]) { return getLatestShoppingList(this.database, access.householdId, displaySystem); }
  getShoppingListById(access: RecipeAccessContext, listId: string, displaySystem?: Parameters<StorageClient["getShoppingListById"]>[2]) { return getShoppingListById(this.database, access.householdId, listId, displaySystem); }
  getShoppingListForPlan(access: RecipeAccessContext, planId: string, listId?: string, displaySystem?: Parameters<StorageClient["getShoppingListForPlan"]>[3]) { return getShoppingListForPlan(this.database, access.householdId, planId, listId, displaySystem); }
  toggleShoppingItem(access: RecipeAccessContext, itemId: string, checked: boolean) { return toggleShoppingItem(this.database, access.householdId, itemId, checked); }
  createShoppingShare(input: Parameters<StorageClient["createShoppingShare"]>[0]) { return createShoppingShare(this.database, input); }
  resolveShoppingShare(token: string, expectedShareId?: string) { return resolveShoppingShare(this.database, token, expectedShareId); }
  revokeShoppingShare(access: RecipeAccessContext, listId: string, shareId: string) { return revokeShoppingShare(this.database, access.householdId, listId, shareId); }
  listShoppingShares(access: RecipeAccessContext, listId: string) { return listShoppingShares(this.database, access.householdId, listId); }
  getPublicShoppingList(share: ResolvedShoppingShare) { return getPublicShoppingList(this.database, share); }
  togglePublicShoppingItem(share: ResolvedShoppingShare, itemId: string, checked: boolean) { return togglePublicShoppingItem(this.database, share, itemId, checked); }
  async touchShoppingShare(shareId: string) { await this.database.prepare("UPDATE shopping_list_shares SET last_accessed_at=CURRENT_TIMESTAMP WHERE id=?").bind(shareId).run(); }
  createApiKey(input: Parameters<StorageClient["createApiKey"]>[0]) { return createApiKey(this.database, input); }
  listApiKeys(userId: string) { return listApiKeys(this.database, userId); }
  async revokeApiKey(userId: string, keyId: string) { await revokeApiKey(this.database, userId, keyId); }
  authenticateApiKey(key: string) { return authenticateApiKeyWithD1(this.database, key); }
  createRecipeIngestion(input: Parameters<StorageClient["createRecipeIngestion"]>[0]) { return createRecipeIngestion(this.database, input); }
  attachRecipeSourceArtifact(input: Parameters<StorageClient["attachRecipeSourceArtifact"]>[0]) { return attachSourceArtifact(this.database, input); }
  async updateRecipeIngestionStatus(ingestionId: string, status: Parameters<StorageClient["updateRecipeIngestionStatus"]>[1], message: string, error?: { code: string; message: string }) { await updateIngestionStatus(this.database, ingestionId, status, message, error); }
  saveRecipeIngestionDraft(ingestionId: string, householdId: string, draft: Parameters<StorageClient["saveRecipeIngestionDraft"]>[2], provider?: string, model?: string) { return saveIngestionDraft(this.database, ingestionId, householdId, draft, provider, model); }
  getRecipeIngestion(ingestionId: string, access: RecipeAccessContext) { return getRecipeIngestion(this.database, ingestionId, access); }
  async getRecipeSourceArtifact(ingestionId: string) {
    const row = await this.database.prepare(`SELECT a.r2_key, a.filename, a.media_type, j.household_id FROM recipe_source_artifacts a JOIN recipe_ingestions j ON j.id=a.ingestion_id WHERE a.ingestion_id=?`).bind(ingestionId).first<{ r2_key: string; filename: string | null; media_type: string; household_id: string }>();
    return row ? { key: row.r2_key, filename: row.filename, mediaType: row.media_type, householdId: row.household_id } : null;
  }
  listIngredientCandidates(query: string, limit?: number) { return listIngredientCandidates(this.database, query, limit); }
  publishRecipeDraft(input: Parameters<StorageClient["publishRecipeDraft"]>[0]) { return publishRecipeDraft(this.database, input); }
  async setRecipeVisibility(recipeId: string, access: RecipeAccessContext, visibility: "user_private" | "household") { await setRecipeVisibility(this.database, recipeId, access, visibility); }
  async updateOwnedRecipe(input: Parameters<StorageClient["updateOwnedRecipe"]>[0]) { await updateOwnedRecipe(this.database, input); }
  async ensureUserHousehold(user: { id: string; name: string }) {
    const preferred = await this.database.prepare(`SELECT up.default_household_id household_id FROM user_profiles up JOIN household_members hm ON hm.household_id=up.default_household_id AND hm.user_id=up.user_id WHERE up.user_id=?`).bind(user.id).first<{ household_id: string }>();
    if (preferred?.household_id) return preferred.household_id;
    const membership = await this.database.prepare(`SELECT household_id FROM household_members WHERE user_id=? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'adult' THEN 1 ELSE 2 END, created_at LIMIT 1`).bind(user.id).first<{ household_id: string }>();
    const householdId = membership?.household_id ?? `household_${user.id}`;
    await this.database.batch([
      this.database.prepare("INSERT OR IGNORE INTO households (id, name, timezone) VALUES (?, ?, ?)").bind(householdId, `${user.name || "My"} family`, "UTC"),
      this.database.prepare("INSERT OR IGNORE INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')").bind(householdId, user.id),
      this.database.prepare(`INSERT INTO user_profiles (user_id, default_household_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET default_household_id=excluded.default_household_id, updated_at=CURRENT_TIMESTAMP`).bind(user.id, householdId),
      this.database.prepare("INSERT OR IGNORE INTO household_preferences (household_id) VALUES (?)").bind(householdId),
    ]);
    return householdId;
  }
  async getUserEmail(userId: string) { return (await this.database.prepare('SELECT email FROM "user" WHERE id=?').bind(userId).first<{ email: string }>())?.email ?? null; }
  getHouseholdOverview(householdId: string, userId: string) { return d1HouseholdOverview(this.database, householdId, userId); }
  async switchDefaultHousehold(userId: string, householdId: string) { await d1SwitchHousehold(this.database, userId, householdId); }
  createHouseholdInvitationRecord(input: Parameters<StorageClient["createHouseholdInvitationRecord"]>[0]) { return d1CreateInvitation(this.database, input); }
  async revokeHouseholdInvitation(householdId: string, userId: string, invitationId: string) { await d1RevokeInvitation(this.database, householdId, userId, invitationId); }
  resolveHouseholdInvitation(token: string) { return d1ResolveInvitation(this.database, token); }
  async acceptHouseholdInvitation(invitation: Parameters<StorageClient["acceptHouseholdInvitation"]>[0], user: { id: string; email: string }) { await d1AcceptInvitation(this.database, invitation, user); }
  claimHouseholdInvitationEmail(invitationId: string) { return d1ClaimInvitationEmail(this.database, invitationId); }
  async updateHouseholdInvitationDelivery(invitationId: string, status: Parameters<StorageClient["updateHouseholdInvitationDelivery"]>[1], details?: { providerMessageId?: string; error?: string }) { await d1InvitationDelivery(this.database, invitationId, status, details); }
  createEmailDelivery(input: Parameters<StorageClient["createEmailDelivery"]>[0]) { return d1CreateEmailDelivery(this.database, input); }
  claimEmailDelivery(deliveryId: string) { return d1ClaimEmail(this.database, deliveryId); }
  async updateEmailDelivery(deliveryId: string, status: Parameters<StorageClient["updateEmailDelivery"]>[1], details?: { providerMessageId?: string; error?: string }) { await d1UpdateEmail(this.database, deliveryId, status, details); }
  getEmailDelivery(householdId: string, userId: string, deliveryId: string) { return d1GetEmail(this.database, householdId, userId, deliveryId); }
}

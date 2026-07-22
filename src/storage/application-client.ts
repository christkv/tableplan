import type { Db } from "mongodb";

import { createMongoApiKeyStore } from "./mongodb/api-keys";
import { createMongoEmailStore } from "./mongodb/email";
import { createMongoHouseholdStore } from "./mongodb/households";
import { createMongoIngestionStore } from "./mongodb/ingestions";
import { createMongoPlanStore } from "./mongodb/plans";
import { createMongoRecipeStore } from "./mongodb/recipes";
import { createMongoShareStore } from "./mongodb/shares";
import { createMongoShoppingStore } from "./mongodb/shopping";
import { createMongoTenantStore } from "./mongodb/tenant";
import type { StorageClient } from "./contract";
import type { MongoGatewayClient } from "./mongo-gateway";

/**
 * Compose domain stores inside the application Worker. The runner is
 * intentionally sequential: the remote gateway never exposes Mongo sessions
 * or multi-document transactions.
 */
export function createApplicationStorageClient(database: Db, mongo: MongoGatewayClient): StorageClient {
  const recipes = createMongoRecipeStore(database);
  const plans = createMongoPlanStore(database, recipes);
  const shopping = createMongoShoppingStore(database, plans, recipes);
  const shares = createMongoShareStore(database, shopping);
  const tenant = createMongoTenantStore(database, recipes);
  const apiKeys = createMongoApiKeyStore(database);
  const ingestions = createMongoIngestionStore(database);
  const households = createMongoHouseholdStore(database);
  const email = createMongoEmailStore(database);

  return {
    async health() {
      const startedAt = performance.now();
      try {
        await mongo.ping();
        return { status: "ok", backend: "mongodb-gateway", latencyMs: performance.now() - startedAt };
      } catch {
        return { status: "unavailable", backend: "mongodb-gateway", latencyMs: performance.now() - startedAt, errorCode: "gateway_unavailable" };
      }
    },
    searchRecipes: (input, access) => recipes.search(input, access),
    listRecipeTagFacets: (input, access) => recipes.facets(input, access),
    getRecipe: (recipeId, access) => recipes.get(recipeId, access),
    isFavorite: (userId, recipeId) => tenant.isFavorite(userId, recipeId),
    setFavorite: (access, recipeId, favorite) => tenant.setFavorite(access, recipeId, favorite),
    listFavorites: (access) => tenant.listFavorites(access),
    getMeasurementSystem: (userId, householdId) => tenant.getMeasurementSystem(userId, householdId),
    updateMeasurementSystem: (userId, householdId, value) => tenant.updateMeasurementSystem(userId, householdId, value),
    getMealPlanSlots: (access) => tenant.getSlots(access),
    updateMealPlanSlots: (access, ids, labels) => tenant.updateSlots(access, ids, labels),
    listSavedRecipeSearches: (access) => tenant.listSavedSearches(access),
    createSavedRecipeSearch: (input) => tenant.createSavedSearch(input),
    deleteSavedRecipeSearch: (access, searchId) => tenant.deleteSavedSearch(access, searchId),
    getMealPlan: (access, startsOn, endsOn) => plans.get(access, startsOn, endsOn),
    getMealPlanById: (access, planId) => plans.getById(access, planId),
    getMealPlanItemContext: (access, itemId, recipeId) => plans.getItemContext(access, itemId, recipeId),
    ensureMealPlan: (input) => plans.ensure(input),
    addMealPlanItem: (input) => plans.addItem(input),
    removeMealPlanItem: (access, itemId) => plans.removeItem(access, itemId),
    updateMealPlanItemServings: (input) => plans.updateServings(input),
    copyMealPlanWeek: (input) => plans.copyWeek(input),
    generateShoppingList: (input) => shopping.generate(input),
    refreshShoppingListForPlan: (access, planId) => shopping.refreshPlan(access, planId),
    refreshShoppingListsForRecipe: (access, recipeId) => shopping.refreshRecipe(access, recipeId),
    getLatestShoppingList: (access, displaySystem) => shopping.getLatest(access, displaySystem),
    getShoppingListById: (access, listId, displaySystem) => shopping.getById(access, listId, displaySystem),
    getShoppingListForPlan: (access, planId, listId, displaySystem) => shopping.getForPlan(access, planId, listId, displaySystem),
    toggleShoppingItem: (access, itemId, checked) => shopping.toggle(access, itemId, checked),
    createShoppingShare: (input) => shares.create(input),
    resolveShoppingShare: (token, expectedShareId) => shares.resolve(token, expectedShareId),
    revokeShoppingShare: (access, listId, shareId) => shares.revoke(access, listId, shareId),
    listShoppingShares: (access, listId) => shares.list(access, listId),
    getPublicShoppingList: (share) => shares.getPublicList(share),
    togglePublicShoppingItem: (share, itemId, checked) => shares.togglePublic(share, itemId, checked),
    touchShoppingShare: (shareId) => shares.touch(shareId),
    createApiKey: (input) => apiKeys.create(input),
    listApiKeys: (userId) => apiKeys.list(userId),
    revokeApiKey: (userId, keyId) => apiKeys.revoke(userId, keyId),
    authenticateApiKey: (key) => apiKeys.authenticate(key),
    createRecipeIngestion: (input) => ingestions.create(input),
    attachRecipeSourceArtifact: (input) => ingestions.attachArtifact(input),
    updateRecipeIngestionStatus: (ingestionId, status, message, error) => ingestions.updateStatus(ingestionId, status, message, error),
    saveRecipeIngestionDraft: (ingestionId, householdId, draft, provider, model) => ingestions.saveDraft(ingestionId, householdId, draft, provider, model),
    getRecipeIngestion: (ingestionId, access) => ingestions.get(ingestionId, access),
    getRecipeSourceArtifact: (ingestionId) => ingestions.getArtifact(ingestionId),
    listIngredientCandidates: (query, limit) => ingestions.candidates(query, limit),
    publishRecipeDraft: (input) => ingestions.publish(input),
    setRecipeVisibility: (recipeId, access, visibility) => ingestions.setVisibility(recipeId, access, visibility),
    updateOwnedRecipe: (input) => ingestions.updateOwned(input),
    ensureUserHousehold: (user) => tenant.ensureUserHousehold(user),
    getUserEmail: (userId) => tenant.getUserEmail(userId),
    getHouseholdOverview: (householdId, userId) => households.overview(householdId, userId),
    switchDefaultHousehold: (userId, householdId) => households.switchDefault(userId, householdId),
    createHouseholdInvitationRecord: (input) => households.createInvitation(input),
    revokeHouseholdInvitation: (householdId, userId, invitationId) => households.revokeInvitation(householdId, userId, invitationId),
    resolveHouseholdInvitation: (token) => households.resolveInvitation(token),
    acceptHouseholdInvitation: (invitation, user) => households.acceptInvitation(invitation, user),
    claimHouseholdInvitationEmail: (invitationId) => households.claimInvitationEmail(invitationId),
    updateHouseholdInvitationDelivery: (invitationId, status, details) => households.updateInvitationDelivery(invitationId, status, details),
    createEmailDelivery: (input) => email.create(input),
    claimEmailDelivery: (deliveryId) => email.claim(deliveryId),
    updateEmailDelivery: (deliveryId, status, details) => email.update(deliveryId, status, details),
    getEmailDelivery: (householdId, userId, deliveryId) => email.get(householdId, userId, deliveryId),
  };
}

import type { Db, Document } from "mongodb";

import { parseMealSlotDefinitions, readStoredMealSlots } from "../../domain/planning/slots";
import { parseMeasurementSystem } from "../../domain/preferences";
import { normalizedSavedSearch, type SavedRecipeSearch } from "../../domain/saved-searches";
import type { RecipeAccessContext, RecipeSearchInput, RecipeSummary } from "../../domain/recipes";
import type { MongoRecipeStore } from "./recipes";

type StringDocument = Document & { _id: string };

export interface MongoTenantStore {
  isFavorite(userId: string, recipeId: string): Promise<boolean>;
  setFavorite(access: RecipeAccessContext, recipeId: string, favorite: boolean): Promise<void>;
  listFavorites(access: RecipeAccessContext): Promise<RecipeSummary[]>;
  getMeasurementSystem(userId: string, householdId: string): Promise<"original" | "us" | "metric">;
  updateMeasurementSystem(userId: string, householdId: string, value: unknown): Promise<"original" | "us" | "metric">;
  getSlots(access: RecipeAccessContext): Promise<{ id: string; label: string }[]>;
  updateSlots(access: RecipeAccessContext, ids: unknown[], labels: unknown[]): Promise<{ id: string; label: string }[]>;
  listSavedSearches(access: RecipeAccessContext): Promise<SavedRecipeSearch[]>;
  createSavedSearch(input: { householdId: string; userId: string; name: unknown; filters: RecipeSearchInput }): Promise<SavedRecipeSearch>;
  deleteSavedSearch(access: RecipeAccessContext, searchId: string): Promise<void>;
  ensureUserHousehold(user: { id: string; name: string }): Promise<string>;
  getUserEmail(userId: string): Promise<string | null>;
}

export function createMongoTenantStore(database: Db, recipes: MongoRecipeStore): MongoTenantStore {
  const memberships = database.collection<StringDocument>("household_memberships");
  const requireMember = async (access: RecipeAccessContext) => {
    if (!await memberships.findOne({ householdId: access.householdId, userId: access.userId }, { projection: { _id: 1 } })) throw new Error("household_access_denied");
  };
  const savedView = (document: StringDocument): SavedRecipeSearch => ({
    id: document._id, name: String(document.name), query: String(document.query ?? ""), ingredient: String(document.ingredient ?? ""),
    tags: Array.isArray(document.tags) ? document.tags.map(String) : [], tagMatch: document.tagMatch === "any" ? "any" : "all",
    scope: document.scope === "catalog" || document.scope === "mine" || document.scope === "household" ? document.scope : "all",
    createdAt: new Date(document.createdAt as string | Date).toISOString(), updatedAt: new Date(document.updatedAt as string | Date).toISOString(),
  });

  return {
    async isFavorite(userId, recipeId) { return Boolean(await database.collection<StringDocument>("favourites").findOne({ userId, recipeId }, { projection: { _id: 1 } })); },
    async setFavorite(access, recipeId, favorite) {
      await requireMember(access);
      if (favorite) {
        if (!await recipes.get(recipeId, access)) throw new Error("recipe_not_found");
        await database.collection<StringDocument>("favourites").updateOne({ userId: access.userId, recipeId }, { $setOnInsert: { _id: crypto.randomUUID(), userId: access.userId, recipeId, createdAt: new Date() } }, { upsert: true });
      } else await database.collection<StringDocument>("favourites").deleteOne({ userId: access.userId, recipeId });
    },
    async listFavorites(access) {
      await requireMember(access);
      const favourites = await database.collection<StringDocument>("favourites").find({ userId: access.userId }).sort({ createdAt: -1 }).limit(500).toArray();
      const values = await Promise.all(favourites.map((item) => recipes.get(String(item.recipeId), access)));
      return values.filter((item): item is NonNullable<typeof item> => Boolean(item));
    },
    async getMeasurementSystem(userId, householdId) {
      await requireMember({ userId, householdId });
      const [profile, household] = await Promise.all([database.collection<StringDocument>("user_profiles").findOne({ _id: userId }), database.collection<StringDocument>("households").findOne({ _id: householdId })]);
      try { return parseMeasurementSystem(profile?.preferredMeasurementSystem ?? (household?.preferences as Document | undefined)?.measurementSystem ?? "original"); }
      catch { return "original"; }
    },
    async updateMeasurementSystem(userId, householdId, value) {
      await requireMember({ userId, householdId });
      const measurementSystem = parseMeasurementSystem(value);
      await database.collection<StringDocument>("user_profiles").updateOne({ _id: userId }, { $set: { preferredMeasurementSystem: measurementSystem, updatedAt: new Date() } }, { upsert: true });
      await database.collection<StringDocument>("households").updateOne({ _id: householdId }, { $set: { "preferences.measurementSystem": measurementSystem, updatedAt: new Date() } });
      return measurementSystem;
    },
    async getSlots(access) {
      await requireMember(access);
      const household = await database.collection<StringDocument>("households").findOne({ _id: access.householdId });
      const preferences = household?.preferences as Document | undefined;
      if (Array.isArray(preferences?.mealSlots)) return parseMealSlotDefinitions(preferences.mealSlots.map((slot) => slot.id), preferences.mealSlots.map((slot) => slot.label));
      return readStoredMealSlots(preferences?.mealSlotsJson);
    },
    async updateSlots(access, ids, labels) {
      await requireMember(access);
      const slots = parseMealSlotDefinitions(ids, labels);
      await database.collection<StringDocument>("households").updateOne({ _id: access.householdId }, { $set: { "preferences.mealSlots": slots, updatedAt: new Date() } });
      return slots;
    },
    async listSavedSearches(access) {
      await requireMember(access);
      return (await database.collection<StringDocument>("saved_recipe_searches").find({ householdId: access.householdId }).sort({ updatedAt: -1, name: 1 }).limit(200).toArray()).map(savedView);
    },
    async createSavedSearch(input) {
      await requireMember({ userId: input.userId, householdId: input.householdId });
      const value = normalizedSavedSearch(input); const now = new Date();
      await database.collection<StringDocument>("saved_recipe_searches").updateOne({ householdId: input.householdId, name: value.name }, { $set: { query: value.query, ingredient: value.ingredient, tags: value.tags, tagMatch: value.tagMatch, scope: value.scope, createdByUserId: input.userId, updatedAt: now }, $setOnInsert: { _id: crypto.randomUUID(), createdAt: now } }, { upsert: true });
      const document = await database.collection<StringDocument>("saved_recipe_searches").findOne({ householdId: input.householdId, name: value.name });
      if (!document) throw new Error("saved_search_create_failed");
      return savedView(document);
    },
    async deleteSavedSearch(access, searchId) { await requireMember(access); await database.collection<StringDocument>("saved_recipe_searches").deleteOne({ _id: searchId, householdId: access.householdId }); },
    async ensureUserHousehold(user) {
      const profile = await database.collection<StringDocument>("user_profiles").findOne({ _id: user.id });
      if (profile?.defaultHouseholdId && await memberships.findOne({ userId: user.id, householdId: profile.defaultHouseholdId })) return String(profile.defaultHouseholdId);
      const membership = await memberships.findOne({ userId: user.id }, { sort: { roleOrder: 1, createdAt: 1 } });
      const householdId = membership ? String(membership.householdId) : `household_${user.id}`;
      await database.collection<StringDocument>("households").updateOne({ _id: householdId }, { $setOnInsert: { name: `${user.name || "My"} family`, timezone: "UTC", preferences: {}, createdAt: new Date() }, $set: { updatedAt: new Date() } }, { upsert: true });
      await memberships.updateOne({ householdId, userId: user.id }, { $setOnInsert: { _id: crypto.randomUUID(), role: "owner", roleOrder: 0, createdAt: new Date() } }, { upsert: true });
      await database.collection<StringDocument>("user_profiles").updateOne({ _id: user.id }, { $set: { userId: user.id, defaultHouseholdId: householdId, updatedAt: new Date() } }, { upsert: true });
      return householdId;
    },
    async getUserEmail(userId) { return String((await database.collection<StringDocument>("users").findOne({ _id: userId }, { projection: { email: 1 } }))?.email ?? "") || null; },
  };
}

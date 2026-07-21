import { normalizeRecipeSearch, recipeSearchUrl } from "./recipe-search";
import type { RecipeSearchInput, RecipeSearchScope, RecipeTagMatch } from "./recipes";

export interface SavedRecipeSearch {
  id: string; name: string; query: string; ingredient: string; tags: string[]; tagMatch: RecipeTagMatch;
  scope: RecipeSearchScope; createdAt: string; updatedAt: string;
}

export function normalizeSavedSearchName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new Error("Saved search name is required");
  if (name.length > 80) throw new Error("Saved search name must be 80 characters or fewer");
  return name;
}

export function savedRecipeSearchUrl(search: Pick<SavedRecipeSearch, "query" | "ingredient" | "tags" | "tagMatch" | "scope">): string {
  return recipeSearchUrl(search);
}

export function normalizedSavedSearch(value: { name: unknown; filters: RecipeSearchInput }) {
  return { name: normalizeSavedSearchName(value.name), ...normalizeRecipeSearch(value.filters) };
}

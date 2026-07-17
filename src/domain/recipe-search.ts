import type { RecipeSearchInput, RecipeSearchScope, RecipeTagMatch } from "./recipes";

export const MAX_RECIPE_SEARCH_TAGS = 12;

export interface RecipeSearchFilters {
  query: string;
  ingredient: string;
  tags: string[];
  tagMatch: RecipeTagMatch;
  scope: RecipeSearchScope;
}

export function normalizeRecipeTags(values: readonly unknown[]): string[] {
  const tags = values
    .flatMap((value) => typeof value === "string" ? value.split(",") : [])
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(tags)].slice(0, MAX_RECIPE_SEARCH_TAGS);
}

export function normalizeTagMatch(value: unknown): RecipeTagMatch {
  return value === "any" ? "any" : "all";
}

export function normalizeRecipeScope(value: unknown): RecipeSearchScope {
  return value === "catalog" || value === "mine" || value === "household" ? value : "all";
}

export function normalizeRecipeSearch(input: RecipeSearchInput = {}): RecipeSearchFilters {
  return {
    query: input.query?.trim() ?? "",
    ingredient: input.ingredient?.trim() ?? "",
    tags: normalizeRecipeTags([...(input.tags ?? []), input.tag]),
    tagMatch: normalizeTagMatch(input.tagMatch),
    scope: normalizeRecipeScope(input.scope),
  };
}

export function recipeSearchParams(input: RecipeSearchInput): URLSearchParams {
  const filters = normalizeRecipeSearch(input);
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.ingredient) params.set("ingredient", filters.ingredient);
  for (const tag of filters.tags) params.append("tag", tag);
  if (filters.tags.length > 1 || filters.tagMatch === "any") params.set("tagMatch", filters.tagMatch);
  if (filters.scope !== "all") params.set("scope", filters.scope);
  return params;
}

export function recipeSearchUrl(input: RecipeSearchInput): string {
  const query = recipeSearchParams(input).toString();
  return query ? `/recipes?${query}` : "/recipes";
}

export function recipeSearchApiUrl(input: RecipeSearchInput, limit: number, offset: number): string {
  const params = recipeSearchParams(input);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return `/api/v1/recipes/search?${params.toString()}`;
}

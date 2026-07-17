import { normalizeRecipeSearch, recipeSearchUrl } from "../domain/recipe-search";
import type { RecipeSearchInput, RecipeTagMatch } from "../domain/recipes";

export interface SavedRecipeSearch {
  id: string;
  name: string;
  query: string;
  ingredient: string;
  tags: string[];
  tagMatch: RecipeTagMatch;
  createdAt: string;
  updatedAt: string;
}

interface SavedRecipeSearchRow {
  id: string;
  name: string;
  query: string;
  ingredient: string;
  tags_json: string;
  tag_match: string;
  created_at: string;
  updated_at: string;
}

function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function toSavedSearch(row: SavedRecipeSearchRow): SavedRecipeSearch {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    ingredient: row.ingredient,
    tags: parseTags(row.tags_json),
    tagMatch: row.tag_match === "any" ? "any" : "all",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeSavedSearchName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new Error("Saved search name is required");
  if (name.length > 80) throw new Error("Saved search name must be 80 characters or fewer");
  return name;
}

export function savedRecipeSearchUrl(search: Pick<SavedRecipeSearch, "query" | "ingredient" | "tags" | "tagMatch">): string {
  return recipeSearchUrl(search);
}

export async function listSavedRecipeSearches(db: D1Database, householdId: string): Promise<SavedRecipeSearch[]> {
  const rows = await db.prepare(`
    SELECT id, name, query, ingredient, tags_json, tag_match, created_at, updated_at
    FROM saved_recipe_searches
    WHERE household_id = ?
    ORDER BY updated_at DESC, name
  `).bind(householdId).all<SavedRecipeSearchRow>();
  return rows.results.map(toSavedSearch);
}

export async function createSavedRecipeSearch(db: D1Database, input: {
  householdId: string;
  userId: string;
  name: unknown;
  filters: RecipeSearchInput;
}): Promise<SavedRecipeSearch> {
  const id = crypto.randomUUID();
  const name = normalizeSavedSearchName(input.name);
  const filters = normalizeRecipeSearch(input.filters);
  await db.prepare(`
    INSERT INTO saved_recipe_searches (id, household_id, created_by_user_id, name, query, ingredient, tags_json, tag_match)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(household_id, name) DO UPDATE SET
      query = excluded.query,
      ingredient = excluded.ingredient,
      tags_json = excluded.tags_json,
      tag_match = excluded.tag_match,
      created_by_user_id = excluded.created_by_user_id,
      updated_at = CURRENT_TIMESTAMP
  `).bind(id, input.householdId, input.userId, name, filters.query, filters.ingredient, JSON.stringify(filters.tags), filters.tagMatch).run();
  const saved = await db.prepare(`
    SELECT id, name, query, ingredient, tags_json, tag_match, created_at, updated_at
    FROM saved_recipe_searches WHERE household_id = ? AND name = ?
  `).bind(input.householdId, name).first<SavedRecipeSearchRow>();
  if (!saved) throw new Error("Saved search could not be created");
  return toSavedSearch(saved);
}

export async function deleteSavedRecipeSearch(db: D1Database, householdId: string, searchId: string): Promise<void> {
  await db.prepare("DELETE FROM saved_recipe_searches WHERE id = ? AND household_id = ?").bind(searchId, householdId).run();
}

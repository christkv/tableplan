import type { RecipeAccessContext, RecipeDetail, RecipeOrigin, RecipeSearchInput, RecipeSearchResult, RecipeSearchScope, RecipeSummary, RecipeTagOption, RecipeVisibility } from "../domain/recipes";
import { normalizeRecipeSearch } from "../domain/recipe-search";

interface RecipeRow {
  id: string;
  source_id: string;
  name: string;
  description: string;
  servings: number | null;
  quality_flags_json: string;
  tags_text: string | null;
  ingredients_text: string | null;
  visibility: RecipeVisibility;
  origin: RecipeOrigin;
  owner_user_id: string | null;
}

function parseList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return value.split("|").map((item) => item.trim()).filter(Boolean);
  }
}

function toSummary(row: RecipeRow, access: RecipeAccessContext): RecipeSummary {
  return {
    id: row.id,
    sourceId: row.source_id,
    name: row.name,
    description: row.description,
    servings: row.servings,
    qualityFlags: parseList(row.quality_flags_json),
    tags: parseList(row.tags_text),
    ingredients: parseList(row.ingredients_text),
    visibility: row.visibility,
    origin: row.origin,
    isOwner: row.owner_user_id === access.userId,
  };
}

export function buildRecipeAccessPredicate(
  access: RecipeAccessContext,
  scope: RecipeSearchScope = "all",
  alias = "r",
): { sql: string; bindings: unknown[] } {
  const active = `${alias}.status = 'active'`;
  if (scope === "catalog") return { sql: `${active} AND ${alias}.visibility = 'catalog'`, bindings: [] };
  if (scope === "mine") return { sql: `${active} AND ${alias}.owner_user_id = ?`, bindings: [access.userId] };
  if (scope === "household") {
    return {
      sql: `${active} AND ${alias}.visibility = 'household' AND ${alias}.owner_household_id = ?`,
      bindings: [access.householdId],
    };
  }
  return {
    sql: `${active} AND (${alias}.visibility = 'catalog' OR ${alias}.owner_user_id = ? OR (${alias}.visibility = 'household' AND ${alias}.owner_household_id = ?))`,
    bindings: [access.userId, access.householdId],
  };
}

export function buildFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" AND ");
}

export function buildRecipeTagPredicate(tags: string[], tagMatch: "all" | "any"): { sql: string; bindings: unknown[] } | null {
  if (!tags.length) return null;
  const placeholders = tags.map(() => "?").join(", ");
  if (tagMatch === "any") {
    return {
      sql: `EXISTS (SELECT 1 FROM recipe_tags filter_rt JOIN tags filter_t ON filter_t.id = filter_rt.tag_id WHERE filter_rt.recipe_id = r.id AND filter_t.name IN (${placeholders}))`,
      bindings: tags,
    };
  }
  return {
    sql: `r.id IN (SELECT filter_rt.recipe_id FROM recipe_tags filter_rt JOIN tags filter_t ON filter_t.id = filter_rt.tag_id WHERE filter_t.name IN (${placeholders}) GROUP BY filter_rt.recipe_id HAVING COUNT(DISTINCT filter_t.name) = ?)`,
    bindings: [...tags, tags.length],
  };
}

function recipeBaseFilter(input: RecipeSearchInput, access: RecipeAccessContext) {
  const filters = normalizeRecipeSearch(input);
  const accessPredicate = buildRecipeAccessPredicate(access, filters.scope);
  const where: string[] = [accessPredicate.sql];
  const bindings: unknown[] = [...accessPredicate.bindings];
  const useFts = Boolean(filters.query);

  if (filters.ingredient) {
    where.push("EXISTS (SELECT 1 FROM recipe_ingredients ri LEFT JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = r.id AND (i.canonical_name LIKE ? OR ri.ingredient_text LIKE ?))");
    bindings.push(`%${filters.ingredient}%`, `%${filters.ingredient}%`);
  }
  if (useFts) {
    where.unshift("recipe_search_fts MATCH ?");
    bindings.unshift(buildFtsQuery(filters.query));
  }
  return { filters, where, bindings, useFts };
}

export async function searchRecipes(db: D1Database, input: RecipeSearchInput, access: RecipeAccessContext): Promise<RecipeSearchResult> {
  const limit = Math.min(Math.max(input.limit ?? 24, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const { filters, where, bindings, useFts } = recipeBaseFilter(input, access);
  const tagPredicate = buildRecipeTagPredicate(filters.tags, filters.tagMatch);
  if (tagPredicate) {
    where.push(tagPredicate.sql);
    bindings.push(...tagPredicate.bindings);
  }

  const from = useFts
    ? "FROM recipe_search_fts f JOIN recipes r ON r.id = f.recipe_id"
    : "FROM recipes r";
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql = useFts ? "ORDER BY bm25(recipe_search_fts), r.name, r.id" : "ORDER BY r.name, r.id";
  const selectSql = `
    SELECT r.id, r.source_id, r.name, r.description, r.servings, r.quality_flags_json,
      r.visibility, r.origin, r.owner_user_id,
      (SELECT json_group_array(t.name) FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id) AS tags_text,
      (SELECT json_group_array(ri.ingredient_text) FROM recipe_ingredients ri WHERE ri.recipe_id = r.id ORDER BY ri.position LIMIT 6) AS ingredients_text
    ${from} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS count ${from} ${whereSql}`;

  const [rows, count] = await Promise.all([
    db.prepare(selectSql).bind(...bindings, limit, offset).all<RecipeRow>(),
    db.prepare(countSql).bind(...bindings).first<{ count: number }>(),
  ]);
  return { recipes: rows.results.map((row) => toSummary(row, access)), total: count?.count ?? 0, limit, offset };
}

export async function listRecipeTagFacets(db: D1Database, input: Pick<RecipeSearchInput, "query" | "ingredient" | "scope">, access: RecipeAccessContext): Promise<RecipeTagOption[]> {
  const { where, bindings, useFts } = recipeBaseFilter(input, access);
  const from = useFts
    ? "FROM recipe_search_fts f JOIN recipes r ON r.id = f.recipe_id"
    : "FROM recipes r";
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await db.prepare(`
    SELECT t.name, COUNT(DISTINCT r.id) AS recipe_count
    ${from}
    JOIN recipe_tags rt ON rt.recipe_id = r.id
    JOIN tags t ON t.id = rt.tag_id
    ${whereSql}
    GROUP BY t.id, t.name
    ORDER BY recipe_count DESC, t.name
  `).bind(...bindings).all<{ name: string; recipe_count: number }>();
  return rows.results.map((row) => ({ name: row.name, recipeCount: row.recipe_count }));
}

export async function getRecipe(db: D1Database, recipeId: string, access: RecipeAccessContext): Promise<RecipeDetail | null> {
  const accessPredicate = buildRecipeAccessPredicate(access);
  const row = await db.prepare(`
    SELECT r.id, r.source_id, r.name, r.description, r.servings, r.serving_size,
      r.quality_flags_json, r.visibility, r.origin, r.owner_user_id,
      (SELECT json_group_array(t.name) FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id) AS tags_text,
      (SELECT json_group_array(ri.ingredient_text) FROM recipe_ingredients ri WHERE ri.recipe_id = r.id ORDER BY ri.position LIMIT 6) AS ingredients_text
    FROM recipes r WHERE r.id = ? AND ${accessPredicate.sql}`).bind(recipeId, ...accessPredicate.bindings).first<RecipeRow & { serving_size: string | null }>();
  if (!row) return null;
  const [ingredients, steps] = await Promise.all([
    db.prepare(`SELECT id, position, raw_line, ingredient_text, quantity_min, quantity_max, unit_id, preparation, parse_status FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position`).bind(recipeId).all<{
      id: string; position: number; raw_line: string; ingredient_text: string; quantity_min: string | null; quantity_max: string | null; unit_id: string | null; preparation: string | null; parse_status: "parsed" | "partial" | "unresolved";
    }>(),
    db.prepare("SELECT position, instruction, parse_status FROM recipe_steps WHERE recipe_id = ? ORDER BY position").bind(recipeId).all<{ position: number; instruction: string; parse_status: string }>(),
  ]);
  return {
    ...toSummary(row, access),
    servingSize: row.serving_size,
    recipeIngredients: ingredients.results.map((item) => ({
      id: item.id, position: item.position, rawLine: item.raw_line, ingredient: item.ingredient_text,
      quantityMin: item.quantity_min, quantityMax: item.quantity_max, unitId: item.unit_id,
      preparation: item.preparation, parseStatus: item.parse_status,
    })),
    steps: steps.results.map((step) => ({ position: step.position, instruction: step.instruction, parseStatus: step.parse_status })),
  };
}

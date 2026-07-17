import type { RecipeDetail, RecipeSearchInput, RecipeSearchResult, RecipeSummary, RecipeTagOption } from "../domain/recipes";
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

function toSummary(row: RecipeRow): RecipeSummary {
  return {
    id: row.id,
    sourceId: row.source_id,
    name: row.name,
    description: row.description,
    servings: row.servings,
    qualityFlags: parseList(row.quality_flags_json),
    tags: parseList(row.tags_text),
    ingredients: parseList(row.ingredients_text),
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

function recipeBaseFilter(input: RecipeSearchInput) {
  const filters = normalizeRecipeSearch(input);
  const where: string[] = [];
  const bindings: unknown[] = [];
  const useFts = Boolean(filters.query);

  if (filters.ingredient) {
    where.push("EXISTS (SELECT 1 FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = r.id AND i.canonical_name LIKE ?)");
    bindings.push(`%${filters.ingredient}%`);
  }
  if (useFts) {
    where.unshift("recipe_search_fts MATCH ?");
    bindings.unshift(buildFtsQuery(filters.query));
  }
  return { filters, where, bindings, useFts };
}

export async function searchRecipes(db: D1Database, input: RecipeSearchInput): Promise<RecipeSearchResult> {
  const limit = Math.min(Math.max(input.limit ?? 24, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const { filters, where, bindings, useFts } = recipeBaseFilter(input);
  const tagPredicate = buildRecipeTagPredicate(filters.tags, filters.tagMatch);
  if (tagPredicate) {
    where.push(tagPredicate.sql);
    bindings.push(...tagPredicate.bindings);
  }

  const from = useFts
    ? "FROM recipe_search_fts f JOIN recipes r ON r.id = f.recipe_id"
    : "FROM recipes r";
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql = useFts ? "ORDER BY bm25(recipe_search_fts), r.name" : "ORDER BY r.name";
  const selectSql = `
    SELECT r.id, r.source_id, r.name, r.description, r.servings, r.quality_flags_json,
      (SELECT json_group_array(t.name) FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id) AS tags_text,
      (SELECT json_group_array(ri.ingredient_text) FROM recipe_ingredients ri WHERE ri.recipe_id = r.id ORDER BY ri.position LIMIT 6) AS ingredients_text
    ${from} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS count ${from} ${whereSql}`;

  const [rows, count] = await Promise.all([
    db.prepare(selectSql).bind(...bindings, limit, offset).all<RecipeRow>(),
    db.prepare(countSql).bind(...bindings).first<{ count: number }>(),
  ]);
  return { recipes: rows.results.map(toSummary), total: count?.count ?? 0, limit, offset };
}

export async function listRecipeTagFacets(db: D1Database, input: Pick<RecipeSearchInput, "query" | "ingredient"> = {}): Promise<RecipeTagOption[]> {
  const { where, bindings, useFts } = recipeBaseFilter(input);
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

export async function getRecipe(db: D1Database, recipeId: string): Promise<RecipeDetail | null> {
  const row = await db.prepare(`
    SELECT r.id, r.source_id, r.name, r.description, r.servings, r.serving_size,
      r.quality_flags_json,
      (SELECT json_group_array(t.name) FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id) AS tags_text,
      (SELECT json_group_array(ri.ingredient_text) FROM recipe_ingredients ri WHERE ri.recipe_id = r.id ORDER BY ri.position LIMIT 6) AS ingredients_text
    FROM recipes r WHERE r.id = ?`).bind(recipeId).first<RecipeRow & { serving_size: string | null }>();
  if (!row) return null;
  const [ingredients, steps] = await Promise.all([
    db.prepare(`SELECT id, position, raw_line, ingredient_text, quantity_min, quantity_max, unit_id, preparation, parse_status FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position`).bind(recipeId).all<{
      id: string; position: number; raw_line: string; ingredient_text: string; quantity_min: string | null; quantity_max: string | null; unit_id: string | null; preparation: string | null; parse_status: "parsed" | "partial" | "unresolved";
    }>(),
    db.prepare("SELECT position, instruction, parse_status FROM recipe_steps WHERE recipe_id = ? ORDER BY position").bind(recipeId).all<{ position: number; instruction: string; parse_status: string }>(),
  ]);
  return {
    ...toSummary(row),
    servingSize: row.serving_size,
    recipeIngredients: ingredients.results.map((item) => ({
      id: item.id, position: item.position, rawLine: item.raw_line, ingredient: item.ingredient_text,
      quantityMin: item.quantity_min, quantityMax: item.quantity_max, unitId: item.unit_id,
      preparation: item.preparation, parseStatus: item.parse_status,
    })),
    steps: steps.results.map((step) => ({ position: step.position, instruction: step.instruction, parseStatus: step.parse_status })),
  };
}

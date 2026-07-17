import type { RecipeSummary } from "../domain/recipes";

interface FavoriteRecipeRow {
  id: string; source_id: string; name: string; description: string; servings: number | null;
  quality_flags_json: string; tags_text: string | null; ingredients_text: string | null;
}

const parseList = (value: string | null): string[] => {
  if (!value) return [];
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
};

const toSummary = (row: FavoriteRecipeRow): RecipeSummary => ({
  id: row.id, sourceId: row.source_id, name: row.name, description: row.description, servings: row.servings,
  qualityFlags: parseList(row.quality_flags_json), tags: parseList(row.tags_text), ingredients: parseList(row.ingredients_text),
});

export async function isFavorite(db: D1Database, userId: string, recipeId: string) {
  return Boolean(await db.prepare("SELECT 1 AS found FROM favorites WHERE user_id = ? AND recipe_id = ?").bind(userId, recipeId).first());
}

export async function setFavorite(db: D1Database, userId: string, recipeId: string, favorite: boolean) {
  if (favorite) await db.prepare("INSERT OR IGNORE INTO favorites (user_id, recipe_id) VALUES (?, ?)").bind(userId, recipeId).run();
  else await db.prepare("DELETE FROM favorites WHERE user_id = ? AND recipe_id = ?").bind(userId, recipeId).run();
}

export async function listFavorites(db: D1Database, userId: string): Promise<RecipeSummary[]> {
  const rows = await db.prepare(`
    SELECT r.id, r.source_id, r.name, r.description, r.servings, r.quality_flags_json,
      (SELECT json_group_array(t.name) FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id) AS tags_text,
      (SELECT json_group_array(ri.ingredient_text) FROM recipe_ingredients ri WHERE ri.recipe_id = r.id ORDER BY ri.position LIMIT 6) AS ingredients_text
    FROM favorites f JOIN recipes r ON r.id = f.recipe_id WHERE f.user_id = ? ORDER BY f.created_at DESC`)
    .bind(userId).all<FavoriteRecipeRow>();
  return rows.results.map(toSummary);
}

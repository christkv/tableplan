import { parseIngredientLine } from "../domain/quantity/parse";
import type { RecipeAccessContext, RecipeVisibility } from "../domain/recipes";
import { normalizeIngredientName, normalizeTag, stableId } from "../import/normalize";
import { normalizeRecipeDraft } from "./extract";
import type { IngredientReview, PublishRecipeInput, RecipeDraft, RecipeIngestionStatus, RecipeIngestionView, RecipeInputKind } from "./types";

interface IngestionRow {
  id: string; user_id: string; household_id: string; input_kind: RecipeInputKind; origin: "manual" | "paste" | "upload";
  status: RecipeIngestionStatus; filename: string | null; media_type: string | null; recipe_id: string | null;
  progress_message: string; error_code: string | null; error_message: string | null;
  title: string | null; description: string | null; servings: number | null; serving_size: string | null;
  ingredients_json: string | null; steps_json: string | null; tags_json: string | null; warnings_json: string | null;
}

const parseArray = (value: string | null): string[] => {
  try { const parsed: unknown = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
};

export async function createRecipeIngestion(db: D1Database, input: {
  userId: string; householdId: string; inputKind: RecipeInputKind; origin: "manual" | "paste" | "upload"; filename?: string; mediaType: string;
}) {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO recipe_ingestions (id, user_id, household_id, input_kind, origin, status, filename, media_type)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`)
    .bind(id, input.userId, input.householdId, input.inputKind, input.origin, input.filename ?? null, input.mediaType).run();
  return id;
}

export async function attachSourceArtifact(db: D1Database, input: { ingestionId: string; key: string; filename?: string; mediaType: string; byteSize: number; sha256: string }) {
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO recipe_source_artifacts (id, ingestion_id, r2_key, filename, media_type, byte_size, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, input.ingestionId, input.key, input.filename ?? null, input.mediaType, input.byteSize, input.sha256),
    db.prepare("UPDATE recipe_ingestions SET source_artifact_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id, input.ingestionId),
  ]);
  return id;
}

export async function updateIngestionStatus(db: D1Database, ingestionId: string, status: RecipeIngestionStatus, message: string, error?: { code: string; message: string }) {
  await db.prepare(`UPDATE recipe_ingestions SET status = ?, progress_message = ?, error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP,
    completed_at = CASE WHEN ? IN ('published', 'failed', 'cancelled') THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id = ?`)
    .bind(status, message, error?.code ?? null, error?.message ?? null, status, ingestionId).run();
}

async function mapIngredient(db: D1Database, householdId: string, parsedName: string): Promise<{ id: string | null; confidence: number }> {
  const normalized = normalizeIngredientName(parsedName);
  if (!normalized) return { id: null, confidence: 0 };
  const household = await db.prepare("SELECT ingredient_id AS id FROM household_ingredient_aliases WHERE household_id = ? AND alias = ? COLLATE NOCASE")
    .bind(householdId, normalized).first<{ id: string }>();
  if (household) return { id: household.id, confidence: 1 };
  const global = await db.prepare(`SELECT id FROM ingredients WHERE canonical_name = ? COLLATE NOCASE
    UNION ALL SELECT ingredient_id AS id FROM ingredient_aliases WHERE alias = ? COLLATE NOCASE LIMIT 1`)
    .bind(normalized, normalized).first<{ id: string }>();
  return global ? { id: global.id, confidence: 0.98 } : { id: null, confidence: 0 };
}

export async function saveIngestionDraft(db: D1Database, ingestionId: string, householdId: string, value: RecipeDraft, provider = "local", model = "deterministic-v1") {
  const draft = normalizeRecipeDraft(value);
  const reviews: IngredientReview[] = [];
  for (const [position, rawLine] of draft.ingredients.entries()) {
    const parsed = parseIngredientLine(rawLine);
    const parsedName = parsed.ingredient || rawLine;
    const mapping = await mapIngredient(db, householdId, parsedName);
    reviews.push({ position, rawLine, parsedName, ingredientId: mapping.id, mappingStatus: mapping.id ? "mapped" : "unmapped", mappingConfidence: mapping.confidence, rememberAlias: false });
  }
  const statements = [
    db.prepare(`INSERT INTO recipe_ingestion_drafts (ingestion_id, title, description, servings, serving_size, ingredients_json, steps_json, tags_json, warnings_json, raw_extraction_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ingestion_id) DO UPDATE SET title=excluded.title, description=excluded.description,
      servings=excluded.servings, serving_size=excluded.serving_size, ingredients_json=excluded.ingredients_json, steps_json=excluded.steps_json,
      tags_json=excluded.tags_json, warnings_json=excluded.warnings_json, raw_extraction_json=excluded.raw_extraction_json, updated_at=CURRENT_TIMESTAMP`)
      .bind(ingestionId, draft.title, draft.description, draft.servings, draft.servingSize, JSON.stringify(draft.ingredients), JSON.stringify(draft.steps), JSON.stringify(draft.tags), JSON.stringify(draft.warnings), JSON.stringify(draft)),
    db.prepare("DELETE FROM recipe_ingestion_ingredient_reviews WHERE ingestion_id = ?").bind(ingestionId),
    ...reviews.map((review) => db.prepare(`INSERT INTO recipe_ingestion_ingredient_reviews
      (ingestion_id, position, raw_line, parsed_name, ingredient_id, mapping_status, mapping_confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(ingestionId, review.position, review.rawLine, review.parsedName, review.ingredientId, review.mappingStatus, review.mappingConfidence)),
    db.prepare(`UPDATE recipe_ingestions SET status='review_ready', progress_message='Ready for review', extraction_provider=?, extraction_model=?, error_code=NULL, error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(provider, model, ingestionId),
  ];
  await db.batch(statements);
  return draft;
}

export async function getRecipeIngestion(db: D1Database, ingestionId: string, access: RecipeAccessContext): Promise<RecipeIngestionView | null> {
  const row = await db.prepare(`SELECT j.*, d.title, d.description, d.servings, d.serving_size, d.ingredients_json, d.steps_json, d.tags_json, d.warnings_json
    FROM recipe_ingestions j LEFT JOIN recipe_ingestion_drafts d ON d.ingestion_id=j.id WHERE j.id=? AND j.user_id=? AND j.household_id=?`)
    .bind(ingestionId, access.userId, access.householdId).first<IngestionRow>();
  if (!row) return null;
  const reviews = await db.prepare(`SELECT position, raw_line, parsed_name, ingredient_id, mapping_status, mapping_confidence, remember_alias
    FROM recipe_ingestion_ingredient_reviews WHERE ingestion_id=? ORDER BY position`).bind(ingestionId).all<{
      position: number; raw_line: string; parsed_name: string; ingredient_id: string | null; mapping_status: IngredientReview["mappingStatus"]; mapping_confidence: number; remember_alias: number;
    }>();
  return {
    id: row.id, userId: row.user_id, householdId: row.household_id, inputKind: row.input_kind, origin: row.origin, status: row.status,
    filename: row.filename, mediaType: row.media_type, recipeId: row.recipe_id, progressMessage: row.progress_message,
    errorCode: row.error_code, errorMessage: row.error_message,
    draft: row.title === null ? null : { title: row.title, description: row.description ?? "", servings: row.servings, servingSize: row.serving_size, ingredients: parseArray(row.ingredients_json), steps: parseArray(row.steps_json), tags: parseArray(row.tags_json), warnings: parseArray(row.warnings_json) },
    ingredientReviews: reviews.results.map((item) => ({ position: item.position, rawLine: item.raw_line, parsedName: item.parsed_name, ingredientId: item.ingredient_id, mappingStatus: item.mapping_status, mappingConfidence: item.mapping_confidence, rememberAlias: Boolean(item.remember_alias) })),
  };
}

export async function listIngredientCandidates(db: D1Database, query: string, limit = 8) {
  const normalized = normalizeIngredientName(query);
  if (!normalized) return [];
  const rows = await db.prepare(`SELECT id, canonical_name, grocery_category FROM ingredients
    WHERE canonical_name LIKE ? ORDER BY CASE WHEN canonical_name = ? COLLATE NOCASE THEN 0 WHEN canonical_name LIKE ? THEN 1 ELSE 2 END, length(canonical_name), canonical_name LIMIT ?`)
    .bind(`%${normalized}%`, normalized, `${normalized}%`, limit).all<{ id: string; canonical_name: string; grocery_category: string | null }>();
  return rows.results.map((row) => ({ id: row.id, name: row.canonical_name, category: row.grocery_category }));
}

export async function publishRecipeDraft(db: D1Database, input: PublishRecipeInput): Promise<string> {
  const draft = normalizeRecipeDraft(input.draft);
  if (!draft.title) throw new Error("Recipe title is required");
  if (!draft.ingredients.length) throw new Error("At least one ingredient is required");
  if (!draft.steps.length) throw new Error("At least one instruction is required");
  const job = await getRecipeIngestion(db, input.ingestionId, { userId: input.userId, householdId: input.householdId });
  if (!job || !["review_ready", "failed"].includes(job.status)) throw new Error("Recipe ingestion is not ready to publish");
  const recipeId = crypto.randomUUID();
  const sourceId = `user:${input.userId}:${recipeId}`;
  const selections = new Map(job.ingredientReviews.map((item) => [item.position, { position: item.position, ingredientId: item.ingredientId, rememberAlias: false }]));
  for (const item of input.ingredientSelections) selections.set(item.position, item);
  const parsedIngredients = draft.ingredients.map((rawLine, position) => ({ position, rawLine, parsed: parseIngredientLine(rawLine), selection: selections.get(position) }));
  const ingredientNames = parsedIngredients.map(({ parsed, rawLine }) => parsed.ingredient || rawLine);
  const statements = [
    db.prepare(`INSERT INTO recipes (id, source_id, name, description, servings, serving_size, quality_flags_json, visibility, owner_user_id, owner_household_id, created_by_user_id, origin, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
      .bind(recipeId, sourceId, draft.title, draft.description, draft.servings, draft.servingSize, JSON.stringify(draft.warnings), input.visibility, input.userId, input.householdId, input.userId, job.origin),
    ...parsedIngredients.map(({ position, rawLine, parsed, selection }) => db.prepare(`INSERT INTO recipe_ingredients
      (id, recipe_id, position, ingredient_id, raw_line, ingredient_text, preparation, quantity_min, quantity_max, unit_id, parse_status, parse_confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), recipeId, position, selection?.ingredientId ?? null, rawLine, parsed.ingredient || rawLine, parsed.preparation ?? null,
        parsed.quantity ? String(parsed.quantity.min) : null, parsed.quantity?.max === undefined ? null : String(parsed.quantity.max), parsed.unit?.id ?? null,
        selection?.ingredientId ? parsed.status === "unresolved" ? "partial" : parsed.status : "unresolved", selection?.ingredientId ? 0.9 : 0)),
    ...draft.steps.map((instruction, position) => db.prepare("INSERT INTO recipe_steps (id, recipe_id, position, instruction, parse_status) VALUES (?, ?, ?, ?, 'parsed')")
      .bind(crypto.randomUUID(), recipeId, position, instruction)),
    ...draft.tags.map((name) => db.prepare("INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)").bind(stableId("tag", normalizeTag(name)), normalizeTag(name))),
    ...draft.tags.map((name) => db.prepare("INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)").bind(recipeId, stableId("tag", normalizeTag(name)))),
    ...parsedIngredients.filter(({ selection }) => selection?.ingredientId && selection.rememberAlias).map(({ parsed, rawLine, selection }) => db.prepare(`INSERT INTO household_ingredient_aliases (household_id, alias, ingredient_id, created_by_user_id)
      VALUES (?, ?, ?, ?) ON CONFLICT(household_id, alias) DO UPDATE SET ingredient_id=excluded.ingredient_id, created_by_user_id=excluded.created_by_user_id`)
      .bind(input.householdId, normalizeIngredientName(parsed.ingredient || rawLine), selection!.ingredientId, input.userId)),
    db.prepare("INSERT INTO recipe_search_fts (recipe_id, name, description, ingredients_text, tags_text, steps_text) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(recipeId, draft.title, draft.description, ingredientNames.join(" "), draft.tags.join(" "), draft.steps.join(" ")),
    db.prepare("INSERT INTO recipe_mutation_events (id, recipe_id, ingestion_id, user_id, event_type) VALUES (?, ?, ?, ?, 'created')")
      .bind(crypto.randomUUID(), recipeId, input.ingestionId, input.userId),
    db.prepare("UPDATE recipe_ingestions SET status='published', recipe_id=?, progress_message='Recipe published', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
      .bind(recipeId, input.ingestionId, input.userId),
  ];
  await db.batch(statements);
  return recipeId;
}

export async function setRecipeVisibility(db: D1Database, recipeId: string, access: RecipeAccessContext, visibility: Extract<RecipeVisibility, "user_private" | "household">) {
  if (visibility === "user_private") {
    const planned = await db.prepare(`SELECT 1 AS found FROM meal_plan_items mpi JOIN meal_plans mp ON mp.id=mpi.meal_plan_id
      WHERE mpi.recipe_id=? AND mp.household_id=? LIMIT 1`).bind(recipeId, access.householdId).first();
    if (planned) throw new Error("Remove this recipe from household meal plans before making it private");
  }
  const result = await db.prepare(`UPDATE recipes SET visibility=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_user_id=? AND owner_household_id=? AND status='active'`)
    .bind(visibility, recipeId, access.userId, access.householdId).run();
  if (!result.meta.changes) throw new Error("Recipe not found or not owned by this user");
  await db.prepare("INSERT INTO recipe_mutation_events (id, recipe_id, user_id, event_type, metadata_json) VALUES (?, ?, ?, 'shared', ?)")
    .bind(crypto.randomUUID(), recipeId, access.userId, JSON.stringify({ visibility })).run();
}

export async function updateOwnedRecipe(db: D1Database, input: { recipeId: string; access: RecipeAccessContext; draft: RecipeDraft }) {
  const draft = normalizeRecipeDraft(input.draft);
  if (!draft.title || !draft.ingredients.length || !draft.steps.length) throw new Error("Title, ingredients, and instructions are required");
  const owned = await db.prepare("SELECT id FROM recipes WHERE id=? AND owner_user_id=? AND owner_household_id=? AND status='active'")
    .bind(input.recipeId, input.access.userId, input.access.householdId).first<{ id: string }>();
  if (!owned) throw new Error("Recipe not found or not owned by this user");
  const parsedIngredients = [];
  for (const [position, rawLine] of draft.ingredients.entries()) {
    const parsed = parseIngredientLine(rawLine);
    const mapping = await mapIngredient(db, input.access.householdId, parsed.ingredient || rawLine);
    parsedIngredients.push({ position, rawLine, parsed, ingredientId: mapping.id });
  }
  await db.batch([
    db.prepare("UPDATE recipes SET name=?, description=?, servings=?, serving_size=?, quality_flags_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_user_id=?")
      .bind(draft.title, draft.description, draft.servings, draft.servingSize, JSON.stringify(draft.warnings), input.recipeId, input.access.userId),
    db.prepare("DELETE FROM recipe_ingredients WHERE recipe_id=?").bind(input.recipeId),
    db.prepare("DELETE FROM recipe_steps WHERE recipe_id=?").bind(input.recipeId),
    db.prepare("DELETE FROM recipe_tags WHERE recipe_id=?").bind(input.recipeId),
    ...parsedIngredients.map(({ position, rawLine, parsed, ingredientId }) => db.prepare(`INSERT INTO recipe_ingredients
      (id, recipe_id, position, ingredient_id, raw_line, ingredient_text, preparation, quantity_min, quantity_max, unit_id, parse_status, parse_confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), input.recipeId, position, ingredientId, rawLine, parsed.ingredient || rawLine, parsed.preparation ?? null,
        parsed.quantity ? String(parsed.quantity.min) : null, parsed.quantity?.max === undefined ? null : String(parsed.quantity.max), parsed.unit?.id ?? null,
        ingredientId ? parsed.status === "unresolved" ? "partial" : parsed.status : "unresolved", ingredientId ? 0.9 : 0)),
    ...draft.steps.map((instruction, position) => db.prepare("INSERT INTO recipe_steps (id, recipe_id, position, instruction, parse_status) VALUES (?, ?, ?, ?, 'parsed')")
      .bind(crypto.randomUUID(), input.recipeId, position, instruction)),
    ...draft.tags.map((name) => db.prepare("INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)").bind(stableId("tag", normalizeTag(name)), normalizeTag(name))),
    ...draft.tags.map((name) => db.prepare("INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)").bind(input.recipeId, stableId("tag", normalizeTag(name)))),
    db.prepare("DELETE FROM recipe_search_fts WHERE recipe_id=?").bind(input.recipeId),
    db.prepare("INSERT INTO recipe_search_fts (recipe_id, name, description, ingredients_text, tags_text, steps_text) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(input.recipeId, draft.title, draft.description, parsedIngredients.map((item) => item.parsed.ingredient || item.rawLine).join(" "), draft.tags.join(" "), draft.steps.join(" ")),
    db.prepare("INSERT INTO recipe_mutation_events (id, recipe_id, user_id, event_type) VALUES (?, ?, ?, 'updated')")
      .bind(crypto.randomUUID(), input.recipeId, input.access.userId),
  ]);
}

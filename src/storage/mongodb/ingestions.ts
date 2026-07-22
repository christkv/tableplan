import type { Db, Document } from "mongodb";

import { parseIngredientLine } from "../../domain/quantity/parse";
import type { RecipeAccessContext } from "../../domain/recipes";
import { normalizeIngredientName, normalizeTag, stableId } from "../../import/normalize";
import { normalizeRecipeDraft } from "../../ingestion/extract";
import type { IngredientReview, PublishRecipeInput, RecipeDraft, RecipeIngestionStatus, RecipeIngestionView, RecipeInputKind } from "../../ingestion/types";

type StringDocument = Document & { _id: string };

export interface MongoIngestionStore {
  create(input: { userId: string; householdId: string; inputKind: RecipeInputKind; origin: "manual" | "paste" | "upload"; filename?: string; mediaType: string }): Promise<string>;
  attachArtifact(input: { ingestionId: string; key: string; filename?: string; mediaType: string; byteSize: number; sha256: string }): Promise<string>;
  updateStatus(ingestionId: string, status: RecipeIngestionStatus, message: string, error?: { code: string; message: string }): Promise<void>;
  saveDraft(ingestionId: string, householdId: string, value: RecipeDraft, provider?: string, model?: string): Promise<RecipeDraft>;
  get(ingestionId: string, access: RecipeAccessContext): Promise<RecipeIngestionView | null>;
  getArtifact(ingestionId: string): Promise<{ key: string; filename: string | null; mediaType: string; householdId: string } | null>;
  candidates(query: string, limit?: number): Promise<Array<{ id: string; name: string; category: string | null }>>;
  publish(input: PublishRecipeInput): Promise<string>;
  setVisibility(recipeId: string, access: RecipeAccessContext, visibility: "user_private" | "household"): Promise<void>;
  updateOwned(input: { recipeId: string; access: RecipeAccessContext; draft: RecipeDraft }): Promise<void>;
}

export function createMongoIngestionStore(database: Db): MongoIngestionStore {
  const ingestions = database.collection<StringDocument>("recipe_ingestions");
  const recipes = database.collection<StringDocument>("recipes");
  const ingredients = database.collection<StringDocument>("ingredients");
  const aliases = database.collection<StringDocument>("ingredient_aliases");
  const memberships = database.collection<StringDocument>("household_memberships");
  const requireMember = async (access: RecipeAccessContext) => {
    if (!await memberships.findOne({ userId: access.userId, householdId: access.householdId }, { projection: { _id: 1 } })) throw new Error("household_access_denied");
  };
  const mapIngredient = async (householdId: string, value: string) => {
    const normalizedName = normalizeIngredientName(value);
    if (!normalizedName) return { id: null, confidence: 0 };
    const alias = await aliases.findOne({ normalizedAlias: normalizedName, $or: [{ householdId }, { householdId: null }] });
    if (alias) return { id: String(alias.ingredientId), confidence: alias.householdId ? 1 : 0.98 };
    const ingredient = await ingredients.findOne({ normalizedName });
    return ingredient ? { id: ingredient._id, confidence: 0.98 } : { id: null, confidence: 0 };
  };
  const recipeIngredients = async (draft: RecipeDraft, householdId: string, selections?: Map<number, { ingredientId: string | null; rememberAlias: boolean }>) => Promise.all(draft.ingredients.map(async (rawLine, position) => {
    const parsed = parseIngredientLine(rawLine);
    const mapped = selections?.has(position) ? selections.get(position)!.ingredientId : (await mapIngredient(householdId, parsed.ingredient || rawLine)).id;
    return {
      id: crypto.randomUUID(), position, rawLine, ingredient: parsed.ingredient || rawLine, canonicalIngredientId: mapped ?? null,
      quantityMin: parsed.quantity ? String(parsed.quantity.min) : null, quantityMax: parsed.quantity?.max === undefined ? null : String(parsed.quantity.max),
      unitId: parsed.unit?.id ?? null, preparation: parsed.preparation ?? null,
      parseStatus: mapped ? (parsed.status === "unresolved" ? "partial" : parsed.status) : "unresolved", parseConfidence: mapped ? 0.9 : 0,
    };
  }));
  const view = (document: StringDocument): RecipeIngestionView => ({
    id: document._id, userId: String(document.userId), householdId: String(document.householdId), inputKind: document.inputKind as RecipeInputKind,
    origin: document.origin as RecipeIngestionView["origin"], status: document.status as RecipeIngestionStatus,
    filename: document.filename ? String(document.filename) : null, mediaType: document.mediaType ? String(document.mediaType) : null,
    recipeId: document.recipeId ? String(document.recipeId) : null, progressMessage: String(document.progressMessage ?? "Queued"),
    errorCode: document.errorCode ? String(document.errorCode) : null, errorMessage: document.errorMessage ? String(document.errorMessage) : null,
    draft: (document.draft as RecipeDraft | null | undefined) ?? null,
    ingredientReviews: (document.ingredientReviews as IngredientReview[] | undefined) ?? [],
  });

  return {
    async create(input) {
      await requireMember(input);
      const id = crypto.randomUUID(); const now = new Date();
      await ingestions.insertOne({ _id: id, ...input, filename: input.filename ?? null, status: "queued", progressMessage: "Queued", recipeId: null, errorCode: null, errorMessage: null, draft: null, ingredientReviews: [], createdAt: now, updatedAt: now });
      return id;
    },
    async attachArtifact(input) {
      const id = crypto.randomUUID();
      const result = await ingestions.updateOne({ _id: input.ingestionId }, { $set: { sourceArtifact: { id, key: input.key, filename: input.filename ?? null, mediaType: input.mediaType, byteSize: input.byteSize, sha256: input.sha256 }, updatedAt: new Date() } });
      if (!result.matchedCount) throw new Error("ingestion_not_found");
      return id;
    },
    async updateStatus(ingestionId, status, message, error) {
      const update: Document = { status, progressMessage: message, errorCode: error?.code ?? null, errorMessage: error?.message ?? null, updatedAt: new Date() };
      if (["published", "failed", "cancelled"].includes(status)) update.completedAt = new Date();
      await ingestions.updateOne({ _id: ingestionId }, { $set: update });
    },
    async saveDraft(ingestionId, householdId, value, provider = "local", model = "deterministic-v1") {
      const draft = normalizeRecipeDraft(value); const reviews: IngredientReview[] = [];
      for (const [position, rawLine] of draft.ingredients.entries()) {
        const parsed = parseIngredientLine(rawLine); const parsedName = parsed.ingredient || rawLine; const mapping = await mapIngredient(householdId, parsedName);
        reviews.push({ position, rawLine, parsedName, ingredientId: mapping.id, mappingStatus: mapping.id ? "mapped" : "unmapped", mappingConfidence: mapping.confidence, rememberAlias: false });
      }
      const result = await ingestions.updateOne({ _id: ingestionId, householdId }, { $set: { draft, ingredientReviews: reviews, status: "review_ready", progressMessage: "Ready for review", extractionProvider: provider, extractionModel: model, errorCode: null, errorMessage: null, updatedAt: new Date() } });
      if (!result.matchedCount) throw new Error("ingestion_not_found");
      return draft;
    },
    async get(ingestionId, access) { const document = await ingestions.findOne({ _id: ingestionId, userId: access.userId, householdId: access.householdId }); return document ? view(document) : null; },
    async getArtifact(ingestionId) {
      const document = await ingestions.findOne({ _id: ingestionId }, { projection: { householdId: 1, sourceArtifact: 1 } });
      const artifact = document?.sourceArtifact as Document | undefined;
      return document && artifact ? { key: String(artifact.key), filename: artifact.filename ? String(artifact.filename) : null, mediaType: String(artifact.mediaType), householdId: String(document.householdId) } : null;
    },
    async candidates(query, limit = 8) {
      const normalized = normalizeIngredientName(query); if (!normalized) return [];
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rows = await ingredients.find({ normalizedName: { $regex: escaped, $options: "i" } }).sort({ normalizedName: 1 }).limit(Math.min(limit, 50)).toArray();
      return rows.map((row) => ({ id: row._id, name: String(row.canonicalName), category: row.groceryCategory ? String(row.groceryCategory) : null }));
    },
    async publish(input) {
      await requireMember(input); const draft = normalizeRecipeDraft(input.draft);
      if (!draft.title || !draft.ingredients.length || !draft.steps.length) throw new Error("Title, ingredients, and instructions are required");
      const job = await ingestions.findOne({ _id: input.ingestionId, userId: input.userId, householdId: input.householdId });
      if (job?.status === "published" && job.recipeId) return String(job.recipeId);
      if (!job || !["review_ready", "failed"].includes(String(job.status))) throw new Error("Recipe ingestion is not ready to publish");
      const selections = new Map(((job.ingredientReviews as IngredientReview[] | undefined) ?? []).map((item) => [item.position, { ingredientId: item.ingredientId, rememberAlias: false }]));
      input.ingredientSelections.forEach((item) => selections.set(item.position, item));
      const embedded = await recipeIngredients(draft, input.householdId, selections); const recipeId = crypto.randomUUID(); const now = new Date();
      const claimed = await ingestions.findOneAndUpdate(
          { _id: input.ingestionId, userId: input.userId, householdId: input.householdId, status: { $in: ["review_ready", "failed"] } },
          { $set: { status: "publishing", progressMessage: "Publishing recipe", updatedAt: now } },
          { returnDocument: "after" },
        );
        if (!claimed) {
          const existing = await ingestions.findOne({ _id: input.ingestionId, userId: input.userId, householdId: input.householdId });
          if (existing?.status === "published" && existing.recipeId) return String(existing.recipeId);
          throw new Error("Recipe ingestion is not ready to publish");
        }
        await recipes.insertOne({ _id: recipeId, sourceId: `user:${input.userId}:${recipeId}`, name: draft.title, description: draft.description, servings: draft.servings, servingSize: draft.servingSize, qualityFlags: draft.warnings, tags: draft.tags.map(normalizeTag), visibility: input.visibility, ownerUserId: input.userId, ownerHouseholdId: input.householdId, createdByUserId: input.userId, origin: job.origin, status: "active", recipeIngredients: embedded, steps: draft.steps.map((instruction, position) => ({ position, instruction, parseStatus: "parsed" })), createdAt: now, updatedAt: now });
        const remembered = embedded.filter((_, position) => selections.get(position)?.ingredientId && selections.get(position)?.rememberAlias);
        for (const item of remembered) await aliases.updateOne({ householdId: input.householdId, normalizedAlias: normalizeIngredientName(item.ingredient) }, { $set: { ingredientId: item.canonicalIngredientId, updatedAt: now }, $setOnInsert: { _id: crypto.randomUUID(), createdByUserId: input.userId, createdAt: now } }, { upsert: true });
        await database.collection<StringDocument>("recipe_mutation_events").insertOne({ _id: crypto.randomUUID(), recipeId, ingestionId: input.ingestionId, userId: input.userId, eventType: "created", createdAt: now });
        await ingestions.updateOne({ _id: input.ingestionId, userId: input.userId }, { $set: { status: "published", recipeId, progressMessage: "Recipe published", completedAt: now, updatedAt: now } });
        return recipeId;
    },
    async setVisibility(recipeId, access, visibility) {
      await requireMember(access);
      if (visibility === "user_private" && await database.collection<StringDocument>("meal_plans").findOne({ householdId: access.householdId, "items.recipeId": recipeId }, { projection: { _id: 1 } })) throw new Error("Remove this recipe from household meal plans before making it private");
      const result = await recipes.updateOne({ _id: recipeId, ownerUserId: access.userId, ownerHouseholdId: access.householdId, status: "active" }, { $set: { visibility, updatedAt: new Date() } });
      if (!result.matchedCount) throw new Error("Recipe not found or not owned by this user");
      await database.collection<StringDocument>("recipe_mutation_events").insertOne({ _id: crypto.randomUUID(), recipeId, userId: access.userId, eventType: "shared", metadata: { visibility }, createdAt: new Date() });
    },
    async updateOwned(input) {
      await requireMember(input.access); const draft = normalizeRecipeDraft(input.draft);
      if (!draft.title || !draft.ingredients.length || !draft.steps.length) throw new Error("Title, ingredients, and instructions are required");
      const embedded = await recipeIngredients(draft, input.access.householdId); const now = new Date();
      const result = await recipes.updateOne({ _id: input.recipeId, ownerUserId: input.access.userId, ownerHouseholdId: input.access.householdId, status: "active" }, { $set: { name: draft.title, description: draft.description, servings: draft.servings, servingSize: draft.servingSize, qualityFlags: draft.warnings, tags: draft.tags.map(normalizeTag), recipeIngredients: embedded, steps: draft.steps.map((instruction, position) => ({ position, instruction, parseStatus: "parsed" })), updatedAt: now } });
      if (!result.matchedCount) throw new Error("Recipe not found or not owned by this user");
      await database.collection<StringDocument>("recipe_mutation_events").insertOne({ _id: crypto.randomUUID(), recipeId: input.recipeId, userId: input.access.userId, eventType: "updated", createdAt: now });
    },
  };
}

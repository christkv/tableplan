import type { Db, Document, Filter } from "mongodb";

import { normalizeRecipeSearch } from "../src/domain/recipe-search";
import type { RecipeAccessContext, RecipeDetail, RecipeSearchInput, RecipeSearchResult, RecipeSummary, RecipeTagOption } from "../src/domain/recipes";

interface RecipeDocument extends Document {
  _id: string;
  sourceId: string;
  name: string;
  description: string;
  servings: number | null;
  servingSize: string | null;
  qualityFlags: string[];
  tags: string[];
  visibility: "catalog" | "user_private" | "household";
  origin: "dataset" | "manual" | "paste" | "upload";
  ownerUserId?: string | null;
  ownerHouseholdId?: string | null;
  status: string;
  recipeIngredients: RecipeDetail["recipeIngredients"];
  steps: RecipeDetail["steps"];
}

function accessFilter(access: RecipeAccessContext, scope: RecipeSearchInput["scope"] = "all"): Filter<RecipeDocument> {
  const active = { status: "active" };
  if (scope === "catalog") return { ...active, visibility: "catalog" };
  if (scope === "mine") return { ...active, ownerUserId: access.userId };
  if (scope === "household") return { ...active, visibility: "household", ownerHouseholdId: access.householdId };
  return { ...active, $or: [{ visibility: "catalog" }, { ownerUserId: access.userId }, { visibility: "household", ownerHouseholdId: access.householdId }] };
}

function summary(document: RecipeDocument, access: RecipeAccessContext): RecipeSummary {
  return {
    id: document._id, sourceId: document.sourceId, name: document.name, description: document.description,
    servings: document.servings ?? null, tags: document.tags ?? [], ingredients: (document.recipeIngredients ?? []).slice(0, 6).map((item) => item.ingredient),
    qualityFlags: document.qualityFlags ?? [], visibility: document.visibility, origin: document.origin, isOwner: document.ownerUserId === access.userId,
  };
}

export interface MongoRecipeStore {
  search(input: RecipeSearchInput, access: RecipeAccessContext): Promise<RecipeSearchResult>;
  facets(input: Pick<RecipeSearchInput, "query" | "ingredient" | "scope">, access: RecipeAccessContext): Promise<RecipeTagOption[]>;
  get(recipeId: string, access: RecipeAccessContext): Promise<RecipeDetail | null>;
}

export function createMongoRecipeStore(database: Db): MongoRecipeStore {
  const recipes = database.collection<RecipeDocument>("recipes");

  function pipeline(input: RecipeSearchInput, access: RecipeAccessContext): Document[] {
    const filters = normalizeRecipeSearch(input);
    const stages: Document[] = [];
    const must = [];
    if (filters.query) must.push({ text: { query: filters.query, path: ["name", "description", "recipeIngredients.ingredient", "recipeIngredients.rawLine", "tags", "steps.instruction"] } });
    if (filters.ingredient) must.push({ text: { query: filters.ingredient, path: ["recipeIngredients.ingredient", "recipeIngredients.rawLine"] } });
    if (must.length) stages.push({ $search: { index: "recipes_v1", compound: { must } } });
    const match: Filter<RecipeDocument> = accessFilter(access, filters.scope);
    if (filters.tags.length) Object.assign(match, { tags: filters.tagMatch === "all" ? { $all: filters.tags } : { $in: filters.tags } });
    stages.push({ $match: match });
    return stages;
  }

  return {
    async search(input, access) {
      const limit = Math.min(Math.max(input.limit ?? 24, 1), 100);
      const offset = Math.min(Math.max(input.offset ?? 0, 0), 100_000);
      const stages = pipeline(input, access);
      if (normalizeRecipeSearch(input).query || normalizeRecipeSearch(input).ingredient) {
        stages.push({ $set: { searchScore: { $meta: "searchScore" } } }, { $sort: { searchScore: -1, name: 1, _id: 1 } });
      } else stages.push({ $sort: { name: 1, _id: 1 } });
      stages.push({ $facet: { rows: [{ $skip: offset }, { $limit: limit }], count: [{ $count: "value" }] } });
      const [result] = await recipes.aggregate<{ rows: RecipeDocument[]; count: { value: number }[] }>(stages).toArray();
      return { recipes: (result?.rows ?? []).map((item) => summary(item, access)), total: result?.count[0]?.value ?? 0, limit, offset };
    },
    async facets(input, access) {
      const rows = await recipes.aggregate<{ _id: string; count: number }>([
        ...pipeline(input, access), { $unwind: "$tags" }, { $group: { _id: "$tags", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: 250 },
      ]).toArray();
      return rows.map((item) => ({ name: item._id, recipeCount: item.count }));
    },
    async get(recipeId, access) {
      const document = await recipes.findOne({ _id: recipeId, ...accessFilter(access) });
      if (!document) return null;
      return { ...summary(document, access), servingSize: document.servingSize ?? null, recipeIngredients: document.recipeIngredients ?? [], steps: document.steps ?? [] };
    },
  };
}

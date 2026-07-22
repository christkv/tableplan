import type { Db, Document, Filter } from "mongodb";

import { normalizeRecipeSearch } from "../../domain/recipe-search";
import type { RecipeAccessContext, RecipeDetail, RecipeSearchInput, RecipeSearchResult, RecipeSearchTotal, RecipeSummary, RecipeTagOption } from "../../domain/recipes";

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

interface TagDocument extends Document {
  _id: string;
  name: string;
  normalizedName: string;
  recipeCount?: number;
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

export async function refreshCatalogRecipeFacets(database: Db): Promise<number> {
  const counts = await database.collection<RecipeDocument>("recipes").aggregate<{ _id: string; recipeCount: number }>([
    { $match: { visibility: "catalog", status: "active" } },
    { $unwind: "$tags" },
    { $group: { _id: "$tags", recipeCount: { $sum: 1 } } },
  ]).toArray();
  const tags = database.collection<TagDocument>("tags");
  if (counts.length) {
    await tags.bulkWrite(counts.map((item) => ({
      updateOne: {
        filter: { name: item._id },
        update: { $set: { recipeCount: item.recipeCount } },
      },
    })), { ordered: false });
  }
  await tags.updateMany({ name: { $nin: counts.map((item) => item._id) } }, { $set: { recipeCount: 0 } });
  return counts.length;
}

export function createMongoRecipeStore(database: Db): MongoRecipeStore {
  const recipes = database.collection<RecipeDocument>("recipes");
  const tags = database.collection<TagDocument>("tags");

  function tagFilter(input: RecipeSearchInput): Document {
    const filters = normalizeRecipeSearch(input);
    if (!filters.tags.length) return {};
    return { tags: filters.tagMatch === "all" ? { $all: filters.tags } : { $in: filters.tags } };
  }

  // Exact filtered counts can scan tens of thousands of multikey candidates. The extra row
  // keeps pagination fast while still proving either a lower bound or a final exact total.
  function windowResult(rows: RecipeDocument[], offset: number, limit: number): { rows: RecipeDocument[]; hasMore: boolean; total: RecipeSearchTotal | null } {
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    if (hasMore) return { rows: pageRows, hasMore, total: { value: offset + limit + 1, relation: "lowerBound" } };
    if (offset === 0 || pageRows.length > 0) return { rows: pageRows, hasMore, total: { value: offset + pageRows.length, relation: "exact" } };
    return { rows: pageRows, hasMore, total: null };
  }

  async function page(match: Filter<RecipeDocument>, offset: number, limit: number) {
    const rows = await recipes.find(match).sort({ name: 1 }).skip(offset).limit(limit + 1).toArray();
    return windowResult(rows, offset, limit);
  }

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
      const filters = normalizeRecipeSearch(input);
      if (!filters.query && !filters.ingredient) {
        const tagsMatch = tagFilter(input);
        if (filters.scope === "all") {
          const fetchLimit = offset + limit + 1;
          const catalogMatch: Filter<RecipeDocument> = { status: "active", visibility: "catalog", ...tagsMatch };
          const customMatch: Filter<RecipeDocument> = {
            status: "active",
            ...tagsMatch,
            $or: [{ ownerUserId: access.userId }, { visibility: "household", ownerHouseholdId: access.householdId }],
          };
          const [catalogRows, customRows] = await Promise.all([
            recipes.find(catalogMatch).sort({ name: 1 }).limit(fetchLimit).toArray(),
            recipes.find(customMatch).sort({ name: 1 }).limit(fetchLimit).toArray(),
          ]);
          const merged = [...catalogRows, ...customRows]
            .sort((left, right) => left.name.localeCompare(right.name) || left._id.localeCompare(right._id))
            .slice(offset, offset + limit + 1);
          const result = windowResult(merged, offset, limit);
          return { recipes: result.rows.map((item) => summary(item, access)), hasMore: result.hasMore, total: result.total, limit, offset };
        }
        const match: Filter<RecipeDocument> = { ...accessFilter(access, filters.scope), ...tagsMatch };
        const result = await page(match, offset, limit);
        return { recipes: result.rows.map((item) => summary(item, access)), hasMore: result.hasMore, total: result.total, limit, offset };
      }
      const stages = pipeline(input, access);
      stages.push({ $set: { searchScore: { $meta: "searchScore" } } }, { $sort: { searchScore: -1, name: 1, _id: 1 } });
      stages.push({ $skip: offset }, { $limit: limit + 1 });
      const rows = await recipes.aggregate<RecipeDocument>(stages).toArray();
      const result = windowResult(rows, offset, limit);
      return { recipes: result.rows.map((item) => summary(item, access)), hasMore: result.hasMore, total: result.total, limit, offset };
    },
    async facets(input, access) {
      const filters = normalizeRecipeSearch(input);
      if (!filters.query && !filters.ingredient && (filters.scope === "catalog" || filters.scope === "all")) {
        const catalog = await tags.find({ recipeCount: { $gt: 0 } }).sort({ recipeCount: -1, name: 1 }).limit(250).toArray();
        if (filters.scope === "catalog") return catalog.map((item) => ({ name: item.name, recipeCount: item.recipeCount ?? 0 }));

        const custom = await recipes.aggregate<{ _id: string; count: number }>([
          { $match: { status: "active", $or: [{ ownerUserId: access.userId }, { visibility: "household", ownerHouseholdId: access.householdId }] } },
          { $unwind: "$tags" },
          { $group: { _id: "$tags", count: { $sum: 1 } } },
        ]).toArray();
        const merged = new Map(catalog.map((item) => [item.name, item.recipeCount ?? 0]));
        for (const item of custom) merged.set(item._id, (merged.get(item._id) ?? 0) + item.count);
        return [...merged.entries()]
          .map(([name, recipeCount]) => ({ name, recipeCount }))
          .sort((left, right) => right.recipeCount - left.recipeCount || left.name.localeCompare(right.name))
          .slice(0, 250);
      }
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

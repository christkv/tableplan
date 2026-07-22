import type { Db, Document, Filter } from "mongodb";
import { describe, expect, it, vi } from "vitest";

import { createMongoRecipeStore } from "./recipes";

function recipe(id: string, name = id) {
  return {
    _id: id,
    sourceId: `source-${id}`,
    name,
    description: "",
    servings: null,
    servingSize: null,
    qualityFlags: [],
    tags: [],
    visibility: "catalog" as const,
    origin: "dataset" as const,
    ownerUserId: null,
    ownerHouseholdId: null,
    status: "active",
    recipeIngredients: [],
    steps: [],
  };
}

function cursor<T>(sourceRows: T[]) {
  let maximum = Number.POSITIVE_INFINITY;
  const value = {
    sort: vi.fn(() => value),
    skip: vi.fn(() => value),
    limit: vi.fn((limit: number) => { maximum = limit; return value; }),
    toArray: vi.fn(async () => sourceRows.slice(0, maximum)),
  };
  return value;
}

function databaseWithRecipes(recipes: object) {
  const tags = { find: vi.fn() };
  return {
    collection: vi.fn((name: string) => name === "recipes" ? recipes : tags),
  } as unknown as Db;
}

const access = { userId: "user-1", householdId: "household-1" };

describe("Mongo recipe search pagination", () => {
  it("fetches one extra recipe and returns a lower bound without counting", async () => {
    const recipeCursor = cursor([recipe("1"), recipe("2"), recipe("3")]);
    const recipes = { find: vi.fn(() => recipeCursor), countDocuments: vi.fn() };
    const store = createMongoRecipeStore(databaseWithRecipes(recipes));

    const result = await store.search({ scope: "catalog", limit: 2 }, access);

    expect(recipeCursor.limit).toHaveBeenCalledWith(3);
    expect(recipes.countDocuments).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      recipes: [{ id: "1" }, { id: "2" }],
      hasMore: true,
      total: { value: 3, relation: "lowerBound" },
      limit: 2,
      offset: 0,
    });
  });

  it("returns an exact total when the final page is reached", async () => {
    const recipeCursor = cursor([recipe("3"), recipe("4")]);
    const recipes = { find: vi.fn(() => recipeCursor), countDocuments: vi.fn() };
    const store = createMongoRecipeStore(databaseWithRecipes(recipes));

    const result = await store.search({ scope: "catalog", offset: 2, limit: 3 }, access);

    expect(result).toMatchObject({
      recipes: [{ id: "3" }, { id: "4" }],
      hasMore: false,
      total: { value: 4, relation: "exact" },
    });
    expect(recipes.countDocuments).not.toHaveBeenCalled();
  });

  it("merges catalog and custom windows before determining whether more rows exist", async () => {
    const recipes = {
      find: vi.fn((match: Filter<Document>) => cursor(match.visibility === "catalog"
        ? [recipe("catalog-b", "B"), recipe("catalog-d", "D")]
        : [recipe("custom-a", "A"), recipe("custom-c", "C")])),
      countDocuments: vi.fn(),
    };
    const store = createMongoRecipeStore(databaseWithRecipes(recipes));

    const result = await store.search({ scope: "all", offset: 1, limit: 2 }, access);

    expect(result).toMatchObject({
      recipes: [{ id: "catalog-b" }, { id: "custom-c" }],
      hasMore: true,
      total: { value: 4, relation: "lowerBound" },
    });
    expect(recipes.countDocuments).not.toHaveBeenCalled();
  });

  it("limits text search instead of adding an exact-count facet", async () => {
    const aggregateCursor = { toArray: vi.fn(async () => [recipe("1"), recipe("2"), recipe("3")]) };
    const recipes = { aggregate: vi.fn((_stages: Document[]) => aggregateCursor), countDocuments: vi.fn() };
    const store = createMongoRecipeStore(databaseWithRecipes(recipes));

    const result = await store.search({ query: "pasta", scope: "catalog", limit: 2 }, access);

    const stages = recipes.aggregate.mock.calls[0][0] as Document[];
    expect(stages).toContainEqual({ $skip: 0 });
    expect(stages).toContainEqual({ $limit: 3 });
    expect(stages.some((stage) => "$facet" in stage)).toBe(false);
    expect(result).toMatchObject({ hasMore: true, total: { value: 3, relation: "lowerBound" } });
    expect(recipes.countDocuments).not.toHaveBeenCalled();
  });
});

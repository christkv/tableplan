import { describe, expect, it } from "vitest";

import { buildFtsQuery, buildRecipeTagPredicate } from "./recipes";

describe("buildFtsQuery", () => {
  it("builds a bounded implicit AND query", () => {
    expect(buildFtsQuery("quick chickpea dinner")).toBe('"quick" AND "chickpea" AND "dinner"');
  });

  it("escapes quotes instead of allowing FTS operators", () => {
    expect(buildFtsQuery('tofu" OR pasta')).toBe('"tofu""" AND "OR" AND "pasta"');
  });

  it("limits token count", () => {
    expect(buildFtsQuery("1 2 3 4 5 6 7 8 9 10 11 12 13").split(" AND ")).toHaveLength(12);
  });
});

describe("buildRecipeTagPredicate", () => {
  it("requires every selected tag in all mode", () => {
    const predicate = buildRecipeTagPredicate(["chicken", "main-dish"], "all");
    expect(predicate?.sql).toContain("GROUP BY filter_rt.recipe_id HAVING COUNT(DISTINCT filter_t.name) = ?");
    expect(predicate?.bindings).toEqual(["chicken", "main-dish", 2]);
  });

  it("accepts any selected tag in any mode", () => {
    const predicate = buildRecipeTagPredicate(["chicken", "main-dish"], "any");
    expect(predicate?.sql).toContain("filter_t.name IN (?, ?)");
    expect(predicate?.sql).not.toContain("HAVING");
    expect(predicate?.bindings).toEqual(["chicken", "main-dish"]);
  });

  it("omits the predicate when no tags are selected", () => {
    expect(buildRecipeTagPredicate([], "all")).toBeNull();
  });
});

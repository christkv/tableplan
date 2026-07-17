import { describe, expect, it } from "vitest";

import { buildFtsQuery, buildRecipeAccessPredicate, buildRecipeTagPredicate } from "./recipes";

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

describe("buildRecipeAccessPredicate", () => {
  const access = { userId: "user-1", householdId: "household-1" };

  it("allows catalog, owned private, and household-shared recipes in all scope", () => {
    const predicate = buildRecipeAccessPredicate(access);
    expect(predicate.sql).toContain("r.visibility = 'catalog'");
    expect(predicate.sql).toContain("r.owner_user_id = ?");
    expect(predicate.sql).toContain("r.owner_household_id = ?");
    expect(predicate.bindings).toEqual(["user-1", "household-1"]);
  });

  it("restricts mine to the authenticated owner", () => {
    expect(buildRecipeAccessPredicate(access, "mine")).toEqual({ sql: "r.status = 'active' AND r.owner_user_id = ?", bindings: ["user-1"] });
  });

  it("restricts household scope to explicitly shared rows", () => {
    const predicate = buildRecipeAccessPredicate(access, "household");
    expect(predicate.sql).toContain("r.visibility = 'household'");
    expect(predicate.bindings).toEqual(["household-1"]);
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

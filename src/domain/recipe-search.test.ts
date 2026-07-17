import { describe, expect, it } from "vitest";

import { normalizeRecipeSearch, normalizeRecipeTags, recipeSearchUrl } from "./recipe-search";

describe("recipe search filters", () => {
  it("deduplicates, trims, and bounds tag values", () => {
    const values = [...Array.from({ length: 14 }, (_, index) => `tag-${index}`), " tag-0 "];
    expect(normalizeRecipeTags(values)).toEqual(Array.from({ length: 12 }, (_, index) => `tag-${index}`));
  });

  it("supports legacy comma-separated tag input", () => {
    expect(normalizeRecipeTags(["chicken, main-dish", "chicken"])).toEqual(["chicken", "main-dish"]);
  });

  it("defaults to all-tag matching", () => {
    expect(normalizeRecipeSearch({ tags: ["chicken"] }).tagMatch).toBe("all");
  });

  it("builds a stable URL with repeated tag parameters", () => {
    expect(recipeSearchUrl({ query: "weeknight", ingredient: "garlic", tags: ["chicken", "main-dish"], tagMatch: "any" }))
      .toBe("/recipes?q=weeknight&ingredient=garlic&tag=chicken&tag=main-dish&tagMatch=any");
  });
});

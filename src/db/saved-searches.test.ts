import { describe, expect, it } from "vitest";

import { normalizeSavedSearchName, savedRecipeSearchUrl } from "./saved-searches";

describe("saved recipe searches", () => {
  it("normalizes a reusable display name", () => {
    expect(normalizeSavedSearchName("  Fast   family dinners ")).toBe("Fast family dinners");
  });

  it("rejects empty and oversized names", () => {
    expect(() => normalizeSavedSearchName("  ")).toThrow("required");
    expect(() => normalizeSavedSearchName("x".repeat(81))).toThrow("80 characters");
  });

  it("turns stored filters back into a recipe URL", () => {
    expect(savedRecipeSearchUrl({ query: "", ingredient: "tofu", tags: ["main-dish"], tagMatch: "all" }))
      .toBe("/recipes?ingredient=tofu&tag=main-dish");
  });
});

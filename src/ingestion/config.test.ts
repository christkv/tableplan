import { describe, expect, it } from "vitest";

import { assertRecipeExtractionAvailable, recipeExtractionAvailability, RecipeExtractionConfigurationError } from "./config";

describe("recipe extraction configuration", () => {
  it("keeps deterministic text ingestion available without credentials", () => {
    expect(recipeExtractionAvailability({ RECIPE_EXTRACTION_PROVIDER: "local" }, "text")).toEqual({ available: true });
  });

  it("rejects binary input before creating a job in local-only mode", () => {
    const availability = recipeExtractionAvailability({ RECIPE_EXTRACTION_PROVIDER: "local" }, "image");
    expect(availability).toMatchObject({ available: false, code: "openrouter_required" });
    expect(availability.message).toContain("RECIPE_EXTRACTION_PROVIDER=openrouter");
  });

  it("requires a non-empty key whenever OpenRouter is selected", () => {
    expect(() => assertRecipeExtractionAvailable({ RECIPE_EXTRACTION_PROVIDER: "openrouter", OPENROUTER_API_KEY: "  " }, "text"))
      .toThrow(RecipeExtractionConfigurationError);
    expect(recipeExtractionAvailability({ RECIPE_EXTRACTION_PROVIDER: "openrouter" }, "image"))
      .toMatchObject({ available: false, code: "openrouter_not_configured" });
  });

  it("allows every supported input kind when OpenRouter is configured", () => {
    const env = { RECIPE_EXTRACTION_PROVIDER: "openrouter" as const, OPENROUTER_API_KEY: "secret" };
    expect(["text", "image", "document"].map((kind) => recipeExtractionAvailability(env, kind as "text" | "image" | "document").available))
      .toEqual([true, true, true]);
  });
});

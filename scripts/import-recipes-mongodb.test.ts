import { describe, expect, it } from "vitest";

import { parseRecipeRow } from "../src/import/recipe-parser";
import { resolveImportDatabase, toMongoRecipe } from "./import-recipes-mongodb";

describe("MongoDB catalog transform", () => {
  it("embeds ordered recipe data while preserving stable IDs", () => {
    const parsed = parseRecipeRow({ id: "42", name: "Toast", description: "", ingredients: '["tomato"]', ingredients_raw: '["1 tomato"]', steps: '["Slice"]', servings: "2", serving_size: "", tags: '["quick"]' });
    const document = toMongoRecipe(parsed, "source-hash");
    expect(document).toMatchObject({ _id: "recipe_42", sourceId: "42", visibility: "catalog", status: "active", tags: ["quick"] });
    expect(document.recipeIngredients[0]).toMatchObject({ position: 0, ingredient: "tomato" });
    expect(document.steps[0]).toMatchObject({ position: 0, instruction: "Slice" });
  });
});

describe("MongoDB catalog target", () => {
  it("uses the preview database without an extra production override", () => {
    expect(resolveImportDatabase("application_preview")).toBe("application_preview");
  });

  it("requires an explicit confirmation for the production database", () => {
    expect(() => resolveImportDatabase("application")).toThrow("--allow-production");
    expect(resolveImportDatabase("application", true)).toBe("application");
  });
});

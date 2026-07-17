import { describe, expect, it } from "vitest";

import { extractRecipeFromText, normalizeRecipeDraft } from "./extract";

describe("recipe text extraction", () => {
  it("extracts headed recipe sections without publishing assumptions", () => {
    const draft = extractRecipeFromText(`Apple &amp; Oat Crumble\nServes 6\n\nIngredients\n- 4 apples, sliced\n- 1 1/2 cups oats\n- 2 tbsp butter\n\nInstructions\n1. Heat the oven to 180 C.\n2. Bake for 30 minutes.`);
    expect(draft.title).toBe("Apple & Oat Crumble");
    expect(draft.servings).toBe(6);
    expect(draft.ingredients).toEqual(["4 apples, sliced", "1 1/2 cups oats", "2 tbsp butter"]);
    expect(draft.steps).toEqual(["Heat the oven to 180 C.", "Bake for 30 minutes."]);
    expect(draft.warnings).toEqual([]);
  });

  it("uses the filename as a bounded fallback and warns about missing fields", () => {
    const draft = extractRecipeFromText("Mystery family note", "summer-soup.md");
    expect(draft.title).toBe("Mystery family note");
    expect(draft.ingredients).toEqual([]);
    expect(draft.warnings).toHaveLength(2);
  });

  it("normalizes model output and rejects invalid servings", () => {
    const draft = normalizeRecipeDraft({ title: "  Soup ", servings: -1, ingredients: [" onion ", "onion"], steps: [" Stir. "], tags: [" Main Dish ", "main dish"] });
    expect(draft.title).toBe("Soup");
    expect(draft.servings).toBeNull();
    expect(draft.ingredients).toEqual(["onion"]);
    expect(draft.tags).toEqual(["main-dish"]);
  });
});

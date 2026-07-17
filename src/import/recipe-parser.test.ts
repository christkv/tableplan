import { describe, expect, it } from "vitest";

import { parseStringList } from "./list-parser";
import { decodeSourceText, normalizeIngredientName, parseServings } from "./normalize";
import { parseRecipeRow, type CsvRecipeRow } from "./recipe-parser";

describe("list parser", () => {
  it("uses strict JSON when valid", () => {
    expect(parseStringList('["one","two"]')).toEqual({ values: ["one", "two"], status: "strict" });
  });

  it("repairs an unescaped interior quote conservatively", () => {
    const result = parseStringList('["don"t overmix", "serve"]');
    expect(result.status).toBe("repaired");
    expect(result.values).toEqual(['don"t overmix', "serve"]);
  });

  it("quarantines values that are not arrays", () => {
    expect(parseStringList("not json").status).toBe("failed");
  });
});

describe("normalization", () => {
  it("removes preparation noise but preserves the ingredient identity", () => {
    expect(normalizeIngredientName("Fresh tomatoes, chopped")).toBe("tomatoes");
  });

  it("flags invalid and unusually large servings", () => {
    expect(parseServings("0")).toEqual({ value: null, flags: ["invalid_servings"] });
    expect(parseServings("100")).toEqual({ value: 100, flags: ["large_servings"] });
  });

  it("decodes named and numeric HTML entities", () => {
    expect(decodeSourceText("&quot;Apple &amp; Pear&#39;s Pie&quot; &#x2014; easy")).toBe(
      '"Apple & Pear\'s Pie" — easy',
    );
    expect(decodeSourceText("Preheat to 350&amp;#730;F")).toBe("Preheat to 350˚F");
  });
});

describe("recipe parser", () => {
  const base: CsvRecipeRow = {
    id: "42",
    name: "Tomato Toast",
    description: "Fast lunch",
    ingredients: '["bread", "tomatoes"]',
    ingredients_raw: '["2 slices bread", "1 lb tomatoes, chopped"]',
    steps: '["Toast bread", "Top with tomatoes"]',
    servings: "2",
    serving_size: "1 plate",
    tags: '["Lunch", "15-minutes-or-less"]',
  };

  it("creates stable relational records", () => {
    const parsed = parseRecipeRow(base);
    expect(parsed.id).toBe("recipe_42");
    expect(parsed.ingredients).toHaveLength(2);
    expect(parsed.ingredients[1]).toMatchObject({ canonicalName: "tomatoes", unitId: "lb", parseStatus: "parsed" });
    expect(parsed.tags.map((tag) => tag.name)).toEqual(["lunch", "15-minutes-or-less"]);
    expect(parsed.issues).toEqual([]);
  });

  it("retains a recipe when steps need repair", () => {
    const parsed = parseRecipeRow({ ...base, steps: '["don"t burn it"]' });
    expect(parsed.steps[0].instruction).toBe('don"t burn it');
    expect(parsed.qualityFlags).toContain("steps_repaired");
    expect(parsed.issues[0]).toMatchObject({ field: "steps", severity: "warning" });
  });

  it("decodes entities in every user-visible imported field", () => {
    const parsed = parseRecipeRow({
      ...base,
      name: "&quot;Apple Pie&quot;",
      description: "Salt &amp; sweet",
      ingredients: '["apples &amp; pears"]',
      ingredients_raw: '["2 apples &amp; pears"]',
      steps: '["Mix &amp; bake"]',
      serving_size: "1 slice &amp; cream",
      tags: '["Kids &amp; Family"]',
    });

    expect(parsed).toMatchObject({
      name: '"Apple Pie"',
      description: "Salt & sweet",
      servingSize: "1 slice & cream",
      cleanedIngredients: ["apples & pears"],
    });
    expect(parsed.ingredients[0].rawLine).toBe("2 apples & pears");
    expect(parsed.steps[0].instruction).toBe("Mix & bake");
    expect(parsed.tags[0].name).toBe("kids-&-family");
  });
});

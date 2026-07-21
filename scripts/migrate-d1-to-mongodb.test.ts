import { describe, expect, it } from "vitest";

import { reviveMongoDates, transformD1Rows } from "./migrate-d1-to-mongodb";

describe("D1 state transformation", () => {
  it("embeds bounded plan items and household preferences", () => {
    const collections = transformD1Rows({
      households: [{ id: "h1", name: "Family" }],
      household_preferences: [{ household_id: "h1", measurement_system: "metric" }],
      meal_plans: [{ id: "p1", household_id: "h1" }],
      meal_plan_items: [{ id: "i1", meal_plan_id: "p1", recipe_id: "r1" }],
    });
    expect(collections.households[0]).toMatchObject({ _id: "h1", preferences: { measurementSystem: "metric" } });
    expect(collections.meal_plans[0]).toMatchObject({ _id: "p1", items: [{ id: "i1", recipeId: "r1" }] });
  });

  it("carries private recipes and normalizes gateway document shapes", () => {
    const collections = transformD1Rows({
      recipes: [{ id: "r1", source_id: "user:u1:r1", name: "Soup", description: "", visibility: "user_private", owner_user_id: "u1", owner_household_id: "h1", origin: "paste", status: "active", quality_flags_json: "[]" }],
      recipe_ingredients: [{ id: "ri1", recipe_id: "r1", position: 0, ingredient_id: null, raw_line: "water", ingredient_text: "water", quantity_min: null, quantity_max: null, unit_id: null, parse_status: "unresolved", parse_confidence: 0 }],
      recipe_steps: [{ id: "s1", recipe_id: "r1", position: 0, instruction: "Heat", parse_status: "parsed" }],
      tags: [{ id: "t1", name: "quick" }], recipe_tags: [{ recipe_id: "r1", tag_id: "t1" }],
      shopping_lists: [{ id: "l1", household_id: "h1", meal_plan_id: "p1" }],
      shopping_list_items: [{ id: "li1", shopping_list_id: "l1", display_name: "Water", checked: 1, unresolved: 0, source_json: "[]" }],
    });
    expect(collections.recipes[0]).toMatchObject({ _id: "r1", tags: ["quick"], recipeIngredients: [{ id: "ri1", ingredient: "water" }], steps: [{ instruction: "Heat" }] });
    expect(collections.shopping_lists[0]).toMatchObject({ planId: "p1", items: [{ id: "li1", name: "Water", checked: true, sources: [] }] });
  });

  it("keeps calendar dates as strings while reviving timestamps", () => {
    const value = reviveMongoDates({ startsOn: "2026-07-20", items: [{ plannedDate: "2026-07-21", createdAt: "2026-07-20T12:00:00.000Z" }] }) as { startsOn: unknown; items: Array<{ plannedDate: unknown; createdAt: unknown }> };
    expect(value.startsOn).toBe("2026-07-20");
    expect(value.items[0].plannedDate).toBe("2026-07-21");
    expect(value.items[0].createdAt).toBeInstanceOf(Date);
  });
});

import { describe, expect, it } from "vitest";

import { openApiDocument } from "./openapi";

describe("OpenAPI document", () => {
  it("publishes stable paths, operation IDs, and bearer authentication", () => {
    const document = openApiDocument("https://tableplan.example");

    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([{ url: "https://tableplan.example/api/v1" }]);
    expect(document.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(Object.keys(document.paths)).toEqual([
      "/health",
      "/recipes/search",
      "/recipes/{recipeId}",
      "/saved-searches",
      "/saved-searches/{savedSearchId}",
      "/meal-plans",
      "/meal-plans/clone-previous",
      "/shopping-lists/generate",
      "/shopping-lists/latest",
    ]);
    expect(document.paths["/meal-plans"].post.operationId).toBe("addRecipeToMealPlan");
    expect(document.paths["/meal-plans/clone-previous"].post.operationId).toBe("clonePreviousMealPlan");
    expect(document.paths["/recipes/search"].get.parameters.map((parameter) => parameter.name)).toEqual(["q", "ingredient", "tag", "tagMatch", "limit"]);
    expect(document.paths["/saved-searches"].post.operationId).toBe("saveRecipeSearch");
  });
});

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
      "/recipes/{recipeId}/pdf",
      "/recipe-ingestions",
      "/recipe-ingestions/{ingestionId}",
      "/saved-searches",
      "/saved-searches/{savedSearchId}",
      "/meal-plans",
      "/meal-plan-items/{itemId}",
      "/meal-plans/clone-previous",
      "/meal-plans/{planId}/pdf",
      "/meal-plans/{planId}/combined.pdf",
      "/shopping-lists/generate",
      "/shopping-lists/latest",
      "/shopping-lists/{listId}/pdf",
      "/shopping-lists/{listId}/shares",
      "/shopping-lists/{listId}/shares/{shareId}",
      "/shopping-lists/{listId}/email",
      "/email-deliveries/{deliveryId}",
    ]);
    expect(document.paths["/meal-plans"].post.operationId).toBe("addRecipeToMealPlan");
    expect(document.paths["/meal-plan-items/{itemId}"].patch.operationId).toBe("updateMealPlanItemServings");
    expect(document.paths["/meal-plans/clone-previous"].post.operationId).toBe("clonePreviousMealPlan");
    expect(document.paths["/recipes/search"].get.parameters.map((parameter) => parameter.name)).toEqual(["q", "ingredient", "tag", "tagMatch", "scope", "limit"]);
    expect(document.paths["/recipe-ingestions"].post.operationId).toBe("createRecipeIngestion");
    expect(document.paths["/recipe-ingestions/{ingestionId}"].post.operationId).toBe("publishRecipeIngestion");
    expect(document.paths["/saved-searches"].post.operationId).toBe("saveRecipeSearch");
    expect(document.paths["/shopping-lists/{listId}/email"].post.operationId).toBe("emailShoppingListToAccount");
    expect(document.paths["/meal-plans/{planId}/combined.pdf"].get.operationId).toBe("downloadCombinedPlanPdf");
  });
});

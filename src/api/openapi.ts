export function openApiDocument(origin: string) {
  const security = [{ bearerAuth: [] }];
  return {
    openapi: "3.1.0",
    info: { title: "Tableplan API", version: "1.0.0", description: "Search recipes, manage weekly plans, and generate combined household shopping lists." },
    servers: [{ url: `${origin}/api/v1` }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Session cookie or an mp_test_/mp_live_ API key" } },
      schemas: { Error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } },
    },
    paths: {
      "/health": { get: { operationId: "getHealth", responses: { "200": { description: "Healthy" } } } },
      "/recipes/search": { get: { operationId: "searchRecipes", security, parameters: [{ name: "q", in: "query", schema: { type: "string" } }, { name: "ingredient", in: "query", schema: { type: "string" } }, { name: "tag", in: "query", description: "Repeat this exact normalized tag parameter to select multiple tags", schema: { type: "array", maxItems: 12, items: { type: "string" } }, style: "form", explode: true }, { name: "tagMatch", in: "query", description: "Require all selected tags or at least one", schema: { enum: ["all", "any"], default: "all" } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } }], responses: { "200": { description: "Paginated recipe results" }, "401": { description: "Unauthorized" } } } },
      "/recipes/{recipeId}": { get: { operationId: "getRecipe", security, parameters: [{ name: "recipeId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Recipe detail" }, "404": { description: "Not found" } } } },
      "/saved-searches": {
        get: { operationId: "listSavedRecipeSearches", security, responses: { "200": { description: "Household saved recipe searches" } } },
        post: { operationId: "saveRecipeSearch", security, requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string", maxLength: 80 }, query: { type: "string" }, ingredient: { type: "string" }, tags: { type: "array", maxItems: 12, items: { type: "string" } }, tagMatch: { enum: ["all", "any"], default: "all" } } } } } }, responses: { "201": { description: "Saved search created or replaced by name" } } },
      },
      "/saved-searches/{savedSearchId}": { delete: { operationId: "deleteSavedRecipeSearch", security, parameters: [{ name: "savedSearchId", in: "path", required: true, schema: { type: "string" } }], responses: { "204": { description: "Saved search deleted" } } } },
      "/meal-plans": {
        get: { operationId: "getMealPlan", security, parameters: [{ name: "week", in: "query", schema: { type: "string", format: "date" } }], responses: { "200": { description: "Weekly plan" } } },
        post: { operationId: "addRecipeToMealPlan", security, requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["week", "recipeId", "date", "slot", "servings"], properties: { week: { type: "string", format: "date" }, recipeId: { type: "string" }, date: { type: "string", format: "date" }, slot: { type: "string" }, servings: { type: "number", exclusiveMinimum: 0 } } } } } }, responses: { "201": { description: "Plan item created" } } },
      },
      "/meal-plans/clone-previous": { post: { operationId: "clonePreviousMealPlan", security, requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["targetWeek"], properties: { targetWeek: { type: "string", format: "date", description: "Any date in the empty target week" } } } } } }, responses: { "201": { description: "Previous week copied into the target week" }, "409": { description: "Source is empty or target already has meals" } } } },
      "/shopping-lists/generate": { post: { operationId: "generateShoppingList", security, requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["planId", "week"], properties: { planId: { type: "string" }, week: { type: "string", format: "date" }, measurementSystem: { enum: ["original", "us", "metric"] } } } } } }, responses: { "201": { description: "Shopping list generated" } } } },
      "/shopping-lists/latest": { get: { operationId: "getLatestShoppingList", security, responses: { "200": { description: "Latest household shopping list" } } } },
    },
  };
}

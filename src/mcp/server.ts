import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as z from "zod/v4";

import type { ApiAccessContext, ApiScope } from "../auth/api-keys";
import { addDays, startOfIsoWeek, weekDates } from "../domain/planning/dates";
import { addMealPlanItem, copyMealPlanWeek, ensureMealPlan, getMealPlan, updateMealPlanItemServings } from "../db/planning";
import { getMealPlanSlots } from "../db/preferences";
import { getRecipe, searchRecipes } from "../db/recipes";
import { createSavedRecipeSearch, deleteSavedRecipeSearch, listSavedRecipeSearches } from "../db/saved-searches";
import { generateShoppingList, getLatestShoppingList, refreshShoppingListForPlan } from "../db/shopping";
import { resolveServingScale, scaleStoredQuantity } from "../domain/quantity/display";
import { getRecipeIngestion, publishRecipeDraft } from "../ingestion/service";
import { startTextRecipeIngestion } from "../ingestion/start";

const result = (value: unknown, text: string) => ({
  content: [{ type: "text" as const, text }],
  structuredContent: value as Record<string, unknown>,
});

function assertScope(access: ApiAccessContext, scope: ApiScope) {
  if (!access.scopes.has(scope)) throw new Error(`Scope ${scope} is required`);
}

export function createMealPlannerMcpServer(env: CloudflareEnvironment, access: ApiAccessContext) {
  const server = new McpServer({ name: "tableplan", version: "1.0.0" }, {
    instructions: "Search recipes before planning. Use explicit ISO dates and servings. Read the current plan before changing it. Generate a shopping list only after the user has selected the intended week.",
  });

  server.registerTool("search_recipes", {
    title: "Search recipes",
    description: "Search the recipe catalog by natural text, ingredient, and multiple exact tags. Tags match all by default. Returns compact recipe records with stable IDs.",
    inputSchema: { query: z.string().optional(), ingredient: z.string().optional(), tags: z.array(z.string().min(1)).max(12).optional(), tagMatch: z.enum(["all", "any"]).default("all"), scope: z.enum(["all", "catalog", "mine", "household"]).default("all"), limit: z.number().int().min(1).max(20).default(8) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, ingredient, tags, tagMatch, scope, limit }) => {
    assertScope(access, "recipes:read");
    const recipes = await searchRecipes(env.DB, { query, ingredient, tags, tagMatch, scope, limit }, access);
    const compact = recipes.recipes.map(({ id, name, description, servings, tags, ingredients }) => ({ id, name, description, servings, tags: tags.slice(0, 8), ingredients: ingredients.slice(0, 8) }));
    return result({ recipes: compact, total: recipes.total }, `Found ${recipes.total} matching recipes; returning ${compact.length}.`);
  });

  server.registerTool("list_saved_searches", {
    title: "List saved recipe searches",
    description: "List reusable recipe filters saved for the authenticated household.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    assertScope(access, "recipes:read");
    const savedSearches = await listSavedRecipeSearches(env.DB, access.householdId);
    return result({ savedSearches }, `Found ${savedSearches.length} saved recipe searches.`);
  });

  server.registerTool("save_recipe_search", {
    title: "Save recipe search",
    description: "Create or replace a named recipe search for the authenticated household.",
    inputSchema: { name: z.string().min(1).max(80), query: z.string().optional(), ingredient: z.string().optional(), tags: z.array(z.string().min(1)).max(12).optional(), tagMatch: z.enum(["all", "any"]).default("all") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ name, query, ingredient, tags, tagMatch }) => {
    assertScope(access, "recipes:write");
    const savedSearch = await createSavedRecipeSearch(env.DB, { householdId: access.householdId, userId: access.userId, name, filters: { query, ingredient, tags, tagMatch } });
    return result({ savedSearch }, `Saved recipe search ${savedSearch.name}.`);
  });

  server.registerTool("delete_saved_search", {
    title: "Delete saved recipe search",
    description: "Delete a saved recipe search by ID from the authenticated household.",
    inputSchema: { savedSearchId: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ savedSearchId }) => {
    assertScope(access, "recipes:write");
    await deleteSavedRecipeSearch(env.DB, access.householdId, savedSearchId);
    return result({ savedSearchId, deleted: true }, `Deleted saved recipe search ${savedSearchId}.`);
  });

  server.registerTool("get_recipe", {
    title: "Get recipe",
    description: "Get one recipe's servings, ingredients, steps, tags, and parse-quality information by stable recipe ID.",
    inputSchema: { recipeId: z.string().min(1), servings: z.number().min(0.25).max(1_000).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ recipeId, servings }) => {
    assertScope(access, "recipes:read");
    const recipe = await getRecipe(env.DB, recipeId, access);
    if (!recipe) throw new Error("Recipe not found");
    const serving = resolveServingScale(recipe.servings, servings);
    const adjustedRecipe = { ...recipe, selectedServings: serving.servings, servingScale: serving.scale, recipeIngredients: recipe.recipeIngredients.map((item) => scaleStoredQuantity(item, serving.scale)) };
    return result({ recipe: adjustedRecipe }, `${recipe.name} is adjusted to ${serving.servings ?? "an unspecified number of"} servings and has ${recipe.recipeIngredients.length} ingredient lines.`);
  });

  server.registerTool("import_recipe_text", {
    title: "Import recipe text",
    description: "Create a private recipe-import job from pasted text. This extracts a reviewable draft but does not publish a recipe. Ask the user to review the draft before publishing it.",
    inputSchema: { text: z.string().min(1).max(102_400), filename: z.string().max(240).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ text, filename }) => {
    assertScope(access, "recipes:write");
    const ingestionId = await startTextRecipeIngestion(env, { userId: access.userId, householdId: access.householdId, text, filename });
    const ingestion = await getRecipeIngestion(env.DB, ingestionId, access);
    return result({ ingestion }, ingestion?.status === "review_ready" ? "The recipe draft is ready for review." : "Recipe extraction has started.");
  });

  server.registerTool("get_recipe_import", {
    title: "Get recipe import",
    description: "Read the status, extracted draft, warnings, and ingredient mappings for one recipe-import job owned by the authenticated user.",
    inputSchema: { ingestionId: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ ingestionId }) => {
    assertScope(access, "recipes:read");
    const ingestion = await getRecipeIngestion(env.DB, ingestionId, access);
    if (!ingestion) throw new Error("Recipe import not found");
    return result({ ingestion }, `Recipe import status: ${ingestion.status}. ${ingestion.progressMessage}`);
  });

  server.registerTool("publish_recipe_import", {
    title: "Publish recipe import",
    description: "Publish a reviewed recipe draft. Defaults to private. Set household visibility only after explicit user confirmation because household recipes can be added to shared plans and shopping lists.",
    inputSchema: {
      ingestionId: z.string().min(1), visibility: z.enum(["user_private", "household"]).default("user_private"),
      title: z.string().min(1).max(240).optional(), description: z.string().max(4_000).optional(), servings: z.number().positive().max(1_000).nullable().optional(),
      ingredients: z.array(z.string().min(1)).min(1).max(250).optional(), steps: z.array(z.string().min(1)).min(1).max(250).optional(), tags: z.array(z.string().min(1)).max(30).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ ingestionId, visibility, title, description, servings, ingredients, steps, tags }) => {
    assertScope(access, "recipes:write");
    const ingestion = await getRecipeIngestion(env.DB, ingestionId, access);
    if (!ingestion?.draft) throw new Error("Recipe draft is not ready");
    const draft = { ...ingestion.draft, ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }), ...(servings === undefined ? {} : { servings }), ...(ingredients === undefined ? {} : { ingredients }), ...(steps === undefined ? {} : { steps }), ...(tags === undefined ? {} : { tags }) };
    const recipeId = await publishRecipeDraft(env.DB, { ingestionId, userId: access.userId, householdId: access.householdId, visibility, draft, ingredientSelections: [] });
    return result({ recipeId, visibility }, `Published ${draft.title} with ${visibility === "household" ? "household" : "private"} visibility.`);
  });

  server.registerTool("get_meal_plan", {
    title: "Get weekly meal plan",
    description: "Read the authenticated household's meal plan for the ISO week containing the supplied date.",
    inputSchema: { week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ week }) => {
    assertScope(access, "plans:read");
    const start = startOfIsoWeek(week);
    const [plan, mealSlots] = await Promise.all([
      getMealPlan(env.DB, access.householdId, start, addDays(start, 6)),
      getMealPlanSlots(env.DB, access.householdId),
    ]);
    return result({ week: start, plan, mealSlots }, plan ? `The week contains ${plan.items.length} planned meals.` : "No meal plan exists for this week.");
  });

  server.registerTool("add_recipe_to_plan", {
    title: "Add recipe to plan",
    description: "Add a recipe to a specific date and meal slot with explicit servings. This changes the household meal plan.",
    inputSchema: { recipeId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slot: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), servings: z.number().positive().max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ recipeId, date, slot, servings }) => {
    assertScope(access, "plans:write");
    const start = startOfIsoWeek(date);
    if (!weekDates(start).includes(date)) throw new Error("Date is outside the resolved week");
    const mealSlots = await getMealPlanSlots(env.DB, access.householdId);
    if (!mealSlots.some((definition) => definition.id === slot)) throw new Error("Meal section is not configured for this household");
    const recipe = await getRecipe(env.DB, recipeId, access);
    if (!recipe) throw new Error("Recipe not found");
    if (recipe.visibility === "user_private") throw new Error("Share this recipe with the household before adding it to a meal plan");
    const planId = await ensureMealPlan(env.DB, { householdId: access.householdId, startsOn: start, endsOn: addDays(start, 6), timezone: "UTC", userId: access.userId });
    const itemId = await addMealPlanItem(env.DB, { householdId: access.householdId, planId, recipeId, date, slot, servings });
    await refreshShoppingListForPlan(env.DB, access.householdId, planId);
    return result({ planId, itemId, recipeId, recipeName: recipe.name, date, slot, servings }, `Added ${recipe.name} to ${date} ${slot} for ${servings} servings.`);
  });

  server.registerTool("update_meal_plan_servings", {
    title: "Update planned servings",
    description: "Change servings for one existing meal-plan item and refresh its linked shopping list quantities.",
    inputSchema: { itemId: z.string().min(1), servings: z.number().min(0.25).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ itemId, servings }) => {
    assertScope(access, "plans:write");
    const planId = await updateMealPlanItemServings(env.DB, { householdId: access.householdId, itemId, servings });
    const shoppingListId = await refreshShoppingListForPlan(env.DB, access.householdId, planId);
    return result({ itemId, planId, servings, shoppingListId }, `Updated the planned meal to ${servings} servings${shoppingListId ? " and refreshed its shopping list" : ""}.`);
  });

  server.registerTool("copy_previous_meal_plan", {
    title: "Copy previous meal plan",
    description: "Copy every meal from the previous ISO week into an empty target week, preserving weekday, slot, servings, notes, and leftovers.",
    inputSchema: { targetWeek: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ targetWeek }) => {
    assertScope(access, "plans:write");
    const targetStartsOn = startOfIsoWeek(targetWeek);
    const copied = await copyMealPlanWeek(env.DB, { householdId: access.householdId, userId: access.userId, sourceStartsOn: addDays(targetStartsOn, -7), targetStartsOn, timezone: "UTC" });
    await refreshShoppingListForPlan(env.DB, access.householdId, copied.planId);
    return result({ ...copied, week: targetStartsOn }, `Copied ${copied.itemCount} meals into the week of ${targetStartsOn}.`);
  });

  server.registerTool("generate_shopping_list", {
    title: "Generate shopping list",
    description: "Create a new combined shopping-list snapshot from an existing meal plan and explicit week. This creates household data.",
    inputSchema: { planId: z.string().min(1), week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), measurementSystem: z.enum(["original", "us", "metric"]).default("metric") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ planId, week, measurementSystem }) => {
    assertScope(access, "shopping:write");
    const start = startOfIsoWeek(week);
    const listId = await generateShoppingList(env.DB, { householdId: access.householdId, planId, startsOn: start, endsOn: addDays(start, 6), userId: access.userId, measurementSystem });
    return result({ listId, planId, week: start, measurementSystem }, `Generated shopping list ${listId} for the week of ${start}.`);
  });

  server.registerTool("get_shopping_list", {
    title: "Get latest shopping list",
    description: "Read the authenticated household's latest shopping list with quantities and source recipes.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    assertScope(access, "shopping:read");
    const list = await getLatestShoppingList(env.DB, access.householdId);
    return result({ list }, list ? `The latest list has ${list.items.length} items.` : "No shopping list exists yet.");
  });

  return server;
}

export async function handleMcpRequest(request: Request, env: CloudflareEnvironment, access: ApiAccessContext) {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createMealPlannerMcpServer(env, access);
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", new URL(request.url).origin);
  headers.set("Access-Control-Expose-Headers", "mcp-session-id,mcp-protocol-version");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

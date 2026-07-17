import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),
  route("sign-in", "routes/sign-in.tsx"),
  layout("routes/app-layout.tsx", [
    route("recipes", "routes/recipes.tsx"),
    route("recipes/:recipeId", "routes/recipe-detail.tsx"),
    route("favorites", "routes/favorites.tsx"),
    route("plan", "routes/plan.tsx"),
    route("shopping", "routes/shopping.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),
  route("api/v1/health", "routes/api.health.ts"),
  route("api/v1/recipes/search", "routes/api.recipes.search.ts"),
  route("api/v1/recipes/:recipeId", "routes/api.recipes.detail.ts"),
  route("api/v1/saved-searches", "routes/api.saved-searches.ts"),
  route("api/v1/saved-searches/:savedSearchId", "routes/api.saved-search.ts"),
  route("api/v1/meal-plans", "routes/api.meal-plans.ts"),
  route("api/v1/meal-plans/clone-previous", "routes/api.meal-plans.clone.ts"),
  route("api/v1/shopping-lists/generate", "routes/api.shopping.generate.ts"),
  route("api/v1/shopping-lists/latest", "routes/api.shopping.latest.ts"),
  route("api/v1/openapi.json", "routes/api.openapi.ts"),
  route("api/auth/*", "routes/api.auth.ts"),
  route("mcp", "routes/mcp.ts"),
] satisfies RouteConfig;

import type { Route } from "./+types/api.recipes.detail";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { getRecipe } from "../../src/db/recipes";
import { resolveServingScale, scaleStoredQuantity } from "../../src/domain/quantity/display";

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "recipes:read");
  if (access instanceof Response) return access;
  const recipe = await getRecipe(env.DB, params.recipeId, access);
  if (!recipe) return Response.json({ code: "recipe_not_found", message: "Recipe not found" }, { status: 404 });
  const serving = resolveServingScale(recipe.servings, new URL(request.url).searchParams.get("servings"));
  return Response.json({ ...recipe, selectedServings: serving.servings, servingScale: serving.scale, recipeIngredients: recipe.recipeIngredients.map((item) => scaleStoredQuantity(item, serving.scale)) });
}

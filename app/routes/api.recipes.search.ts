import type { Route } from "./+types/api.recipes.search";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { searchRecipes } from "../../src/db/recipes";
import { normalizeRecipeScope } from "../../src/domain/recipe-search";

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "recipes:read");
  if (access instanceof Response) return access;
  const result = await searchRecipes(env.DB, {
    query: url.searchParams.get("q") ?? undefined,
    ingredient: url.searchParams.get("ingredient") ?? undefined,
    tags: url.searchParams.getAll("tag"),
    tagMatch: url.searchParams.get("tagMatch") === "any" ? "any" : "all",
    scope: normalizeRecipeScope(url.searchParams.get("scope")),
    limit: Number(url.searchParams.get("limit") ?? 24),
    offset: Number(url.searchParams.get("offset") ?? 0),
  }, access);
  return Response.json(result);
}

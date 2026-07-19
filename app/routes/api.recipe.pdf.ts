import type { Route } from "./+types/api.recipe.pdf";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { getMeasurementSystem } from "../../src/db/preferences";
import { buildRecipeExport, parseExportOptions, safeExportFilename } from "../../src/exports/models";
import { renderPdfResponse } from "../../src/exports/pdf";
import { renderRecipeHtml } from "../../src/exports/render";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "recipes:read");
  if (access instanceof Response) return access;
  const measurementSystem = await getMeasurementSystem(env.DB, access.userId, access.householdId);
  const options = parseExportOptions(new URL(request.url).searchParams, { measurementSystem });
  const model = await buildRecipeExport(env.DB, params.recipeId, access, options);
  if (!model) throw new Response("Recipe not found", { status: 404 });
  return renderPdfResponse(env, renderRecipeHtml(model), {
    filename: `recipe-${safeExportFilename(model.title)}-${model.servings ?? "yield"}.pdf`,
    paper: options.paper,
  });
}

import type { Route } from "./+types/api.combined.pdf";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { getMeasurementSystem } from "../../src/db/preferences";
import { buildCombinedExport, parseExportOptions, safeExportFilename } from "../../src/exports/models";
import { renderPdfResponse } from "../../src/exports/pdf";
import { renderCombinedHtml } from "../../src/exports/render";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "plans:read");
  if (access instanceof Response) return access;
  if (!access.scopes.has("shopping:read")) return Response.json({ code: "forbidden", message: "Scope shopping:read is required" }, { status: 403 });
  const url = new URL(request.url);
  const measurementSystem = await getMeasurementSystem(env.DB, access.userId, access.householdId);
  const options = parseExportOptions(url.searchParams, { measurementSystem });
  const model = await buildCombinedExport(env.DB, access.householdId, params.planId, url.searchParams.get("shoppingListId") ?? undefined, options);
  if (!model) throw new Response("A linked meal plan and shopping list were not found", { status: 404 });
  return renderPdfResponse(env, renderCombinedHtml(model), { filename: `meal-plan-and-shopping-${safeExportFilename(model.plan.startsOn)}.pdf`, paper: options.paper, landscape: true });
}

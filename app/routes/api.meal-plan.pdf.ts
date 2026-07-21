import type { Route } from "./+types/api.meal-plan.pdf";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { createStorageClient } from "../../src/storage";
import { buildMealPlanExport, parseExportOptions, safeExportFilename } from "../../src/exports/models";
import { renderPdfResponse } from "../../src/exports/pdf";
import { renderMealPlanHtml } from "../../src/exports/render";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "plans:read");
  if (access instanceof Response) return access;
  const measurementSystem = await createStorageClient(env).getMeasurementSystem(access.userId, access.householdId);
  const options = parseExportOptions(new URL(request.url).searchParams, { measurementSystem });
  const model = await buildMealPlanExport(createStorageClient(env), access, params.planId);
  if (!model) throw new Response("Meal plan not found", { status: 404 });
  return renderPdfResponse(env, renderMealPlanHtml(model), { filename: `meal-plan-${safeExportFilename(model.startsOn)}.pdf`, paper: options.paper, landscape: true });
}

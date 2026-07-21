import type { Route } from "./+types/api.shopping.pdf";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { createStorageClient } from "../../src/storage";
import { buildShoppingListExport, parseExportOptions, safeExportFilename } from "../../src/exports/models";
import { renderPdfResponse } from "../../src/exports/pdf";
import { renderShoppingListHtml } from "../../src/exports/render";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "shopping:read");
  if (access instanceof Response) return access;
  const measurementSystem = await createStorageClient(env).getMeasurementSystem(access.userId, access.householdId);
  const options = parseExportOptions(new URL(request.url).searchParams, { measurementSystem });
  const model = await buildShoppingListExport(createStorageClient(env), access, params.listId, options);
  if (!model) throw new Response("Shopping list not found", { status: 404 });
  return renderPdfResponse(env, renderShoppingListHtml(model), { filename: `shopping-list-${safeExportFilename(model.title)}.pdf`, paper: options.paper });
}

import type { Route } from "./+types/api.recipe-ingestion";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { createStorageClient } from "../../src/storage";
import type { RecipeDraft } from "../../src/ingestion/types";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "recipes:read");
  if (access instanceof Response) return access;
  const ingestion = await createStorageClient(env).getRecipeIngestion(params.ingestionId, access);
  return ingestion ? Response.json({ ingestion }) : Response.json({ code: "recipe_ingestion_not_found", message: "Recipe ingestion not found" }, { status: 404 });
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "recipes:write");
  if (access instanceof Response) return access;
  const storage = createStorageClient(env);
  const ingestion = await storage.getRecipeIngestion(params.ingestionId, access);
  if (!ingestion?.draft) return Response.json({ code: "recipe_ingestion_not_ready", message: "Recipe draft is not ready" }, { status: 409 });
  const body = await request.json<{ draft?: Partial<RecipeDraft>; visibility?: string; ingredientSelections?: Array<{ position: number; ingredientId: string | null; rememberAlias?: boolean }> }>();
  const draft = { ...ingestion.draft, ...(body.draft ?? {}) };
  try {
    const recipeId = await storage.publishRecipeDraft({
      ingestionId: ingestion.id, userId: access.userId, householdId: access.householdId,
      visibility: body.visibility === "household" ? "household" : "user_private", draft,
      ingredientSelections: (body.ingredientSelections ?? []).map((item) => ({ ...item, rememberAlias: Boolean(item.rememberAlias) })),
    });
    return Response.json({ recipeId, recipeUrl: `/api/v1/recipes/${recipeId}` }, { status: 201 });
  } catch (error) {
    return Response.json({ code: "recipe_publish_failed", message: error instanceof Error ? error.message : "Recipe could not be published" }, { status: 400 });
  }
}

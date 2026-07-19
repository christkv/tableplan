import type { Route } from "./+types/api.recipe-ingestions";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { RecipeExtractionConfigurationError } from "../../src/ingestion/config";
import { startTextRecipeIngestion } from "../../src/ingestion/start";

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "recipes:write");
  if (access instanceof Response) return access;
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ code: "unsupported_media_type", message: "Use application/json" }, { status: 415 });
  const body = await request.json<{ text?: unknown; filename?: unknown }>();
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ code: "invalid_recipe_text", message: "text is required" }, { status: 400 });
  if (new TextEncoder().encode(text).byteLength > 100 * 1024) return Response.json({ code: "recipe_text_too_large", message: "text must be 100 KiB or smaller" }, { status: 413 });
  try {
    const ingestionId = await startTextRecipeIngestion(env, { userId: access.userId, householdId: access.householdId, text, filename: typeof body.filename === "string" ? body.filename : undefined });
    return Response.json({ ingestionId, statusUrl: `/api/v1/recipe-ingestions/${ingestionId}` }, { status: 202 });
  } catch (error) {
    if (error instanceof RecipeExtractionConfigurationError) return Response.json({ code: error.code, message: error.message }, { status: 503 });
    throw error;
  }
}

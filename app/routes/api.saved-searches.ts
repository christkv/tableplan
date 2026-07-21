import type { Route } from "./+types/api.saved-searches";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { createStorageClient } from "../../src/storage";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "recipes:read");
  if (access instanceof Response) return access;
  return Response.json({ savedSearches: await createStorageClient(env).listSavedRecipeSearches(access) });
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "recipes:write");
  if (access instanceof Response) return access;
  if (request.method !== "POST") return Response.json({ code: "method_not_allowed", message: "Use POST to save a search" }, { status: 405 });
  try {
    const body = await request.json<{ name?: string; query?: string; ingredient?: string; tags?: string[]; tagMatch?: "all" | "any" }>();
    const savedSearch = await createStorageClient(env).createSavedRecipeSearch({
      householdId: access.householdId,
      userId: access.userId,
      name: body.name,
      filters: body,
    });
    return Response.json({ savedSearch }, { status: 201 });
  } catch (error) {
    return Response.json({ code: "invalid_saved_search", message: error instanceof Error ? error.message : "Invalid saved search" }, { status: 400 });
  }
}

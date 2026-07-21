import type { Route } from "./+types/api.saved-search";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { createStorageClient } from "../../src/storage";

export async function action({ request, context, params }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "recipes:write");
  if (access instanceof Response) return access;
  if (request.method !== "DELETE") return Response.json({ code: "method_not_allowed", message: "Use DELETE to remove a saved search" }, { status: 405 });
  await createStorageClient(env).deleteSavedRecipeSearch(access, params.savedSearchId);
  return new Response(null, { status: 204 });
}

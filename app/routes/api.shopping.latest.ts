import type { Route } from "./+types/api.shopping.latest";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { createStorageClient } from "../../src/storage";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "shopping:read");
  if (access instanceof Response) return access;
  return Response.json({ list: await createStorageClient(env).getLatestShoppingList(access) });
}

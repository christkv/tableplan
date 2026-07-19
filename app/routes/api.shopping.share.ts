import type { Route } from "./+types/api.shopping.share";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { revokeShoppingShare } from "../../src/sharing/shopping-share";

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "shopping:write");
  if (access instanceof Response) return access;
  if (request.method !== "DELETE") return Response.json({ code: "method_not_allowed" }, { status: 405 });
  const revoked = await revokeShoppingShare(env.DB, access.householdId, params.listId, params.shareId);
  return revoked ? Response.json({ revoked: true }) : Response.json({ code: "share_not_found" }, { status: 404 });
}

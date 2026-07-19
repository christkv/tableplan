import type { Route } from "./+types/api.public.shopping";
import { cloudflareContext } from "../context";
import { getPublicShoppingList, publicSecurityHeaders, readShareCookie, resolveShoppingShare } from "../../src/sharing/shopping-share";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const share = await resolveShoppingShare(env.DB, readShareCookie(request) ?? "", params.shareId);
  if (!share) return Response.json({ code: "invalid_or_expired_link" }, { status: 410, headers: publicSecurityHeaders() });
  ctx.waitUntil(env.DB.prepare("UPDATE shopping_list_shares SET last_accessed_at=CURRENT_TIMESTAMP WHERE id=?").bind(share.id).run().then(() => undefined));
  const list = await getPublicShoppingList(env.DB, share);
  return list ? Response.json({ list }, { headers: publicSecurityHeaders() }) : Response.json({ code: "list_not_found" }, { status: 410, headers: publicSecurityHeaders() });
}

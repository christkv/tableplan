import type { Route } from "./+types/api.public.shopping";
import { cloudflareContext } from "../context";
import { publicSecurityHeaders, readShareCookie } from "../../src/sharing/shopping-share";
import { createStorageClient } from "../../src/storage";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const storage = createStorageClient(env); const share = await storage.resolveShoppingShare(readShareCookie(request) ?? "", params.shareId);
  if (!share) return Response.json({ code: "invalid_or_expired_link" }, { status: 410, headers: publicSecurityHeaders() });
  ctx.waitUntil(storage.touchShoppingShare(share.id));
  const list = await storage.getPublicShoppingList(share);
  return list ? Response.json({ list }, { headers: publicSecurityHeaders() }) : Response.json({ code: "list_not_found" }, { status: 410, headers: publicSecurityHeaders() });
}

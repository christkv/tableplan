import type { Route } from "./+types/api.public.shopping.item";
import { cloudflareContext } from "../context";
import { publicSecurityHeaders, readShareCookie } from "../../src/sharing/shopping-share";
import { createStorageClient } from "../../src/storage";

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ code: "invalid_origin" }, { status: 403, headers: publicSecurityHeaders() });
  const storage = createStorageClient(env); const share = await storage.resolveShoppingShare(readShareCookie(request) ?? "", params.shareId);
  if (!share) return Response.json({ code: "invalid_or_expired_link" }, { status: 410, headers: publicSecurityHeaders() });
  const body = await request.json().catch(() => null) as { checked?: boolean } | null;
  if (typeof body?.checked !== "boolean") return Response.json({ code: "invalid_checked_state" }, { status: 400, headers: publicSecurityHeaders() });
  const updated = await storage.togglePublicShoppingItem(share, params.itemId, body.checked);
  return updated ? Response.json({ itemId: params.itemId, checked: body.checked }, { headers: publicSecurityHeaders() }) : Response.json({ code: "item_not_found" }, { status: 404, headers: publicSecurityHeaders() });
}

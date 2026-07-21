import type { Route } from "./+types/api.public.shopping.exchange";
import { cloudflareContext } from "../context";
import { createShareCookie, publicSecurityHeaders } from "../../src/sharing/shopping-share";
import { createStorageClient } from "../../src/storage";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ code: "invalid_origin" }, { status: 403, headers: publicSecurityHeaders() });
  const body = await request.json().catch(() => null) as { token?: string } | null;
  const share = await createStorageClient(env).resolveShoppingShare(body?.token ?? "");
  if (!share) return Response.json({ code: "invalid_or_expired_link", message: "This checklist link is no longer available." }, { status: 410, headers: publicSecurityHeaders() });
  const headers = new Headers(publicSecurityHeaders());
  headers.append("Set-Cookie", createShareCookie(body?.token ?? "", share.expiresAt, env.APP_ENV !== "local"));
  return Response.json({ shareId: share.id, expiresAt: share.expiresAt }, { headers });
}

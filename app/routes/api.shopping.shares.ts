import type { Route } from "./+types/api.shopping.shares";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { parseShareExpiryDays } from "../../src/domain/shopping-share";
import { createStorageClient } from "../../src/storage";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "shopping:read");
  if (access instanceof Response) return access;
  return Response.json({ shares: await createStorageClient(env).listShoppingShares(access, params.listId) });
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "shopping:write");
  if (access instanceof Response) return access;
  const body = await request.json().catch(() => null) as { expiresInDays?: number } | null;
  try {
    const share = await createStorageClient(env).createShoppingShare({ householdId: access.householdId, userId: access.userId, listId: params.listId, expiresInDays: parseShareExpiryDays(body?.expiresInDays) });
    const baseUrl = ((env as CloudflareEnvironment & { PUBLIC_APP_URL?: string }).PUBLIC_APP_URL ?? env.BETTER_AUTH_URL).replace(/\/$/, "");
    return Response.json({ shareId: share.id, shareUrl: `${baseUrl}/shared/shopping#access=${encodeURIComponent(share.token)}`, expiresAt: share.expiresAt }, { status: 201 });
  } catch (error) {
    return Response.json({ code: "share_not_created", message: error instanceof Error ? error.message : "Share could not be created" }, { status: 400 });
  }
}

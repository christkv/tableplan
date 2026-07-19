import type { Route } from "./+types/api.shopping.email";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { queueShoppingListEmail } from "../../src/email/shopping-email";
import { parseShareExpiryDays } from "../../src/sharing/shopping-share";

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "shopping:write");
  if (access instanceof Response) return access;
  const body = await request.json().catch(() => null) as { expiresInDays?: number } | null;
  const user = await env.DB.prepare('SELECT email FROM "user" WHERE id=?').bind(access.userId).first<{ email: string }>();
  if (!user) return Response.json({ code: "user_not_found" }, { status: 404 });
  try {
    const result = await queueShoppingListEmail(env, { householdId: access.householdId, userId: access.userId, listId: params.listId, recipientEmail: user.email, expiresInDays: parseShareExpiryDays(body?.expiresInDays) });
    return Response.json(result, { status: 202 });
  } catch (error) {
    return Response.json({ code: "email_not_queued", message: error instanceof Error ? error.message : "Email could not be queued" }, { status: 400 });
  }
}

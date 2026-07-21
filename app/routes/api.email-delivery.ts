import type { Route } from "./+types/api.email-delivery";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { createStorageClient } from "../../src/storage";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "shopping:read");
  if (access instanceof Response) return access;
  const delivery = await createStorageClient(env).getEmailDelivery(access.householdId, access.userId, params.deliveryId);
  return delivery ? Response.json({ delivery }) : Response.json({ code: "delivery_not_found" }, { status: 404 });
}

import type { Route } from "./+types/api.shopping.generate";
import { cloudflareContext } from "../context";
import { requireApiScope } from "../../src/auth/api-keys";
import { addDays, startOfIsoWeek } from "../../src/domain/planning/dates";
import { createStorageClient } from "../../src/storage";

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await requireApiScope(request, env, ctx, "shopping:write");
  if (access instanceof Response) return access;
  const body = await request.json<{ planId: string; week: string; measurementSystem?: "original" | "us" | "metric" }>();
  const start = startOfIsoWeek(body.week);
  const listId = await createStorageClient(env).generateShoppingList({ householdId: access.householdId, planId: body.planId, startsOn: start, endsOn: addDays(start, 6), userId: access.userId, measurementSystem: body.measurementSystem ?? "metric" });
  return Response.json({ listId }, { status: 201 });
}

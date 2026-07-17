import type { Route } from "./+types/api.auth";
import { cloudflareContext } from "../context";
import { createAuth } from "../../src/auth/server";

async function handle(request: Request, context: Route.LoaderArgs["context"]) {
  const { env, ctx } = context.get(cloudflareContext);
  return createAuth(env, ctx).handler(request);
}

export function loader({ request, context }: Route.LoaderArgs) {
  return handle(request, context);
}

export function action({ request, context }: Route.ActionArgs) {
  return handle(request, context);
}

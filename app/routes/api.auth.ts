import type { Route } from "./+types/api.auth";
import { cloudflareContext } from "../context";
import { handleAuthRequest } from "../../src/auth/server";

async function handle(request: Request, context: Route.LoaderArgs["context"]) {
  const { env, ctx } = context.get(cloudflareContext);
  return handleAuthRequest(request, env, ctx);
}

export function loader({ request, context }: Route.LoaderArgs) {
  return handle(request, context);
}

export function action({ request, context }: Route.ActionArgs) {
  return handle(request, context);
}

import type { Route } from "./+types/mcp";
import { cloudflareContext } from "../context";
import { authenticateApiRequest } from "../../src/auth/api-keys";
import { handleMcpRequest } from "../../src/mcp/server";

async function handle(request: Request, context: Route.LoaderArgs["context"]) {
  const { env, ctx } = context.get(cloudflareContext);
  const access = await authenticateApiRequest(request, env, ctx);
  if (!access) return Response.json({ error: "invalid_token", error_description: "A valid session or API key is required" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  return handleMcpRequest(request, env, access);
}

export function loader({ request, context }: Route.LoaderArgs) { return handle(request, context); }
export function action({ request, context }: Route.ActionArgs) { return handle(request, context); }

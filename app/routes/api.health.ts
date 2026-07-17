import type { Route } from "./+types/api.health";
import { cloudflareContext } from "../context";

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  let database = "ok";
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
  } catch {
    database = "unavailable";
  }
  return Response.json({
    status: database === "ok" ? "ok" : "degraded",
    database,
    environment: env.APP_ENV,
    timestamp: new Date().toISOString(),
  }, { status: database === "ok" ? 200 : 503 });
}

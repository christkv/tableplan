import type { Route } from "./+types/api.openapi";
import { openApiDocument } from "../../src/api/openapi";

export function loader({ request }: Route.LoaderArgs) {
  return Response.json(openApiDocument(new URL(request.url).origin));
}

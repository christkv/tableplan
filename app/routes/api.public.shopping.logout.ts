import type { Route } from "./+types/api.public.shopping.logout";
import { redirect } from "react-router";
import { cloudflareContext } from "../context";
import { clearShareCookie, publicSecurityHeaders } from "../../src/sharing/shopping-share";

export async function action({ context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const headers = new Headers(publicSecurityHeaders());
  headers.append("Set-Cookie", clearShareCookie(env.APP_ENV !== "local"));
  return redirect("/shared/shopping", { headers });
}

import { createRequestHandler, RouterContextProvider } from "react-router";

import { cloudflareContext } from "../app/context";

export { RecipeIngestionAgent, RecipeIngestionWorkflow } from "./recipe-ingestion";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
    return requestHandler(request, context);
  },
} satisfies ExportedHandler<CloudflareEnvironment>;

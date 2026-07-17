import { createContext } from "react-router";

export interface CloudflareLoadContext {
  env: CloudflareEnvironment;
  ctx: ExecutionContext;
}

export const cloudflareContext = createContext<CloudflareLoadContext>();

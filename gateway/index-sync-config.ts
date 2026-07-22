export type IndexSyncEnvironment = "local" | "preview" | "production";

export interface IndexSyncTarget {
  environment: IndexSyncEnvironment;
  database: string;
  uri: string;
  dryRun: boolean;
}

const expectedDatabases: Record<IndexSyncEnvironment, string> = {
  local: "application_local",
  preview: "application_preview",
  production: "application",
};

export function resolveIndexSyncTarget(args: string[], environment: NodeJS.ProcessEnv): IndexSyncTarget {
  const environmentFlag = args.indexOf("--environment");
  const requested = environmentFlag >= 0 ? args[environmentFlag + 1] : environment.APP_ENV;
  const dryRun = args.includes("--dry-run");
  if (requested !== "local" && requested !== "preview" && requested !== "production") throw new Error("Pass --environment local, preview, or production");
  if (environment.APP_ENV && environment.APP_ENV !== requested) throw new Error(`APP_ENV=${environment.APP_ENV} does not match requested environment ${requested}`);
  if (!environment.MONGODB_URI) throw new Error("MONGODB_URI is required");
  const database = expectedDatabases[requested];
  if (environment.MONGODB_DATABASE !== database) throw new Error(`${requested} index sync must target MONGODB_DATABASE=${database}`);
  if (requested === "production" && !dryRun && !args.includes("--confirm-production")) {
    throw new Error("Production index sync requires --confirm-production; run with --dry-run first");
  }
  return { environment: requested, database, uri: environment.MONGODB_URI, dryRun };
}

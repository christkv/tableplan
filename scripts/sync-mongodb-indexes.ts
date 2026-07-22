import { MongoClient } from "mongodb";

import { resolveIndexSyncTarget } from "../gateway/index-sync-config";
import { syncMongoIndexes } from "../gateway/index-sync";
import { collectionDefinitions } from "../gateway/schema";

const target = resolveIndexSyncTarget(process.argv.slice(2), process.env);

const client = new MongoClient(target.uri, { appName: `tableplan-index-sync-${target.environment}` });
try {
  await client.connect();
  process.stdout.write(`MongoDB index sync ${target.dryRun ? "plan" : "apply"}: ${target.environment}/${target.database}\n`);
  const summary = await syncMongoIndexes(client.db(target.database), collectionDefinitions, {
    dryRun: target.dryRun,
    log: (message) => process.stdout.write(`[index-sync] ${message}\n`),
  });
  process.stdout.write(`MongoDB index sync complete: ${JSON.stringify({ environment: target.environment, database: target.database, dryRun: target.dryRun, ...summary })}\n`);
} finally {
  await client.close();
}

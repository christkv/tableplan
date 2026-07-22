#!/usr/bin/env node
import { loadGatewayConfig } from "../gateway/config";
import { createMongoRuntime } from "../gateway/mongo";
import { refreshCatalogRecipeFacets } from "../gateway/recipes";

const config = loadGatewayConfig(process.env);
const mongo = createMongoRuntime(config);

try {
  await mongo.connect();
  const count = await refreshCatalogRecipeFacets(mongo.database);
  process.stdout.write(`Recipe facet counts refreshed: ${count} tags in ${config.MONGODB_DATABASE}\n`);
} finally {
  await mongo.close();
}

import { loadGatewayConfig } from "./config";
import { createMongoRuntime } from "./mongo";
import { ensureMongoSchema } from "./schema";

const config = loadGatewayConfig(process.env);
const mongo = createMongoRuntime(config);
try {
  await mongo.connect();
  await ensureMongoSchema(mongo.database);
  if (process.argv.includes("--atlas-search")) {
    const recipes = mongo.database.collection("recipes");
    const existing = await recipes.listSearchIndexes("recipes_v1").toArray();
    if (!existing.length) await recipes.createSearchIndex({ name: "recipes_v1", definition: { mappings: { dynamic: false, fields: {
      name: { type: "string" }, description: { type: "string" }, tags: { type: "string" },
      recipeIngredients: { type: "document", fields: { ingredient: { type: "string" }, rawLine: { type: "string" } } },
      steps: { type: "document", fields: { instruction: { type: "string" } }, },
    } } } });
  }
  process.stdout.write(`MongoDB schema ready: ${config.MONGODB_DATABASE}\n`);
} finally {
  await mongo.close();
}

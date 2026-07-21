#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BSON, type AnyBulkWriteOperation, type Db, type Document } from "mongodb";
import { Command } from "commander";
import { parse } from "csv-parse";

import { loadGatewayConfig } from "../gateway/config";
import { createMongoRuntime } from "../gateway/mongo";
import { UNITS } from "../src/domain/quantity/units";
import { parseRecipeRow, type CsvRecipeRow, type ParsedRecipeRow } from "../src/import/recipe-parser";

const IMPORTER_VERSION = "mongodb-0.1.0";
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export function toMongoRecipe(recipe: ParsedRecipeRow, sourceHash: string) {
  return {
    _id: recipe.id,
    sourceId: recipe.sourceId,
    name: recipe.name,
    description: recipe.description,
    servings: recipe.servings,
    servingSize: recipe.servingSize,
    qualityFlags: recipe.qualityFlags,
    tags: recipe.tags.map((tag) => tag.name),
    visibility: "catalog" as const,
    origin: "dataset" as const,
    status: "active",
    sourceHash,
    recipeIngredients: recipe.ingredients.map((item) => ({
      id: item.id, position: item.position, rawLine: item.rawLine, ingredient: item.ingredientName,
      canonicalIngredientId: item.canonicalId, quantityMin: item.quantityMin, quantityMax: item.quantityMax,
      unitId: item.unitId, preparation: item.preparation, parseStatus: item.parseStatus, parseConfidence: item.parseConfidence,
    })),
    steps: recipe.steps.map((step) => ({ position: step.position, instruction: step.instruction, parseStatus: step.parseStatus })),
    updatedAt: new Date(),
  };
}

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function records(path: string): AsyncIterable<CsvRecipeRow> {
  return createReadStream(path).pipe(parse({ columns: true, bom: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true, max_record_size: 5 * 1024 * 1024 })) as AsyncIterable<CsvRecipeRow>;
}

interface Batch {
  recipes: AnyBulkWriteOperation<StringDocument>[];
  ingredients: AnyBulkWriteOperation<StringDocument>[];
  tags: AnyBulkWriteOperation<StringDocument>[];
  issues: AnyBulkWriteOperation<StringDocument>[];
}
type StringDocument = Document & { _id: string };

const emptyBatch = (): Batch => ({ recipes: [], ingredients: [], tags: [], issues: [] });

async function flush(database: Db, batch: Batch) {
  await Promise.all([
    batch.recipes.length ? database.collection<StringDocument>("recipes").bulkWrite(batch.recipes, { ordered: false }) : undefined,
    batch.ingredients.length ? database.collection<StringDocument>("ingredients").bulkWrite(batch.ingredients, { ordered: true }) : undefined,
    batch.tags.length ? database.collection<StringDocument>("tags").bulkWrite(batch.tags, { ordered: true }) : undefined,
    batch.issues.length ? database.collection<StringDocument>("import_issues").bulkWrite(batch.issues, { ordered: false }) : undefined,
  ]);
}

export async function importCatalog(sourcePath: string, options: { batchSize: number; limit?: number; runId?: string }) {
  if (!existsSync(sourcePath)) throw new Error(`Source file not found: ${sourcePath}`);
  const config = loadGatewayConfig(process.env);
  const mongo = createMongoRuntime({ ...config, MONGODB_MAX_POOL_SIZE: Math.min(config.MONGODB_MAX_POOL_SIZE, 4) });
  await mongo.connect();
  const database = mongo.database;
  const sourceHash = await sha256(sourcePath);
  const runId = options.runId ?? `catalog_${sourceHash.slice(0, 16)}`;
  const runs = database.collection<StringDocument & { checkpointRow?: number; status?: string }>("import_runs");
  const previous = await runs.findOne({ _id: runId });
  const checkpoint = previous?.checkpointRow ?? 0;
  await runs.updateOne({ _id: runId }, { $set: {
    sourcePath, sourceHash, sourceSize: statSync(sourcePath).size, importerVersion: IMPORTER_VERSION,
    status: "running", resumedAt: new Date(),
  }, $setOnInsert: { startedAt: new Date(), rowsImported: 0, rowsRejected: 0 } }, { upsert: true });
  await database.collection<StringDocument>("units").bulkWrite(UNITS.map((unit) => ({ updateOne: { filter: { _id: unit.id }, update: { $set: { canonicalName: unit.name, symbol: unit.symbol, dimension: unit.dimension, toBaseFactor: unit.toBase, system: unit.system } }, upsert: true } })), { ordered: false });

  let rowNumber = 0; let imported = 0; let rejected = 0; let batch = emptyBatch();
  const seen = new Set<string>();
  try {
    for await (const row of records(sourcePath)) {
      rowNumber += 1;
      const sourceId = row.id.trim();
      const duplicate = seen.has(sourceId);
      seen.add(sourceId);
      if (rowNumber <= checkpoint) continue;
      if (duplicate) { rejected += 1; continue; }
      if (options.limit && imported >= options.limit) break;
      const parsed = parseRecipeRow(row);
      const document = toMongoRecipe(parsed, sourceHash);
      const documentSize = BSON.calculateObjectSize(document);
      if (documentSize > MAX_DOCUMENT_BYTES) {
        rejected += 1;
        batch.issues.push({ updateOne: { filter: { _id: `${runId}_${rowNumber}_oversized` }, update: { $set: { importRunId: runId, sourceRecipeId: sourceId, rowNumber, field: "recipe", severity: "error", reasonCode: "mongodb_document_too_large", documentSize } }, upsert: true } });
      } else {
        batch.recipes.push({ replaceOne: { filter: { _id: parsed.id }, replacement: document, upsert: true } });
        for (const ingredient of parsed.ingredients) if (ingredient.canonicalId) batch.ingredients.push({ updateOne: { filter: { _id: ingredient.canonicalId }, update: { $set: { canonicalName: ingredient.canonicalName, normalizedName: ingredient.canonicalName } }, upsert: true } });
        for (const tag of parsed.tags) batch.tags.push({ updateOne: { filter: { _id: tag.id }, update: { $set: { name: tag.name, normalizedName: tag.name } }, upsert: true } });
        parsed.issues.forEach((issue, index) => batch.issues.push({ updateOne: { filter: { _id: `${runId}_${rowNumber}_${index}` }, update: { $set: { importRunId: runId, sourceRecipeId: sourceId, rowNumber, ...issue } }, upsert: true } }));
        imported += 1;
      }
      if (batch.recipes.length + rejected >= options.batchSize) {
        await flush(database, batch);
        await runs.updateOne({ _id: runId }, { $set: { checkpointRow: rowNumber, updatedAt: new Date() }, $inc: { rowsImported: batch.recipes.length, rowsRejected: rejected } });
        batch = emptyBatch(); rejected = 0;
      }
    }
    await flush(database, batch);
    await runs.updateOne({ _id: runId }, { $set: { checkpointRow: rowNumber, status: "completed", completedAt: new Date() }, $inc: { rowsImported: batch.recipes.length, rowsRejected: rejected } });
    return { runId, sourceHash, checkpointRow: rowNumber, imported };
  } catch (error) {
    await runs.updateOne({ _id: runId }, { $set: { status: "failed", checkpointRow: rowNumber, failedAt: new Date(), errorCode: "catalog_import_failed" } });
    throw error;
  } finally {
    await mongo.close();
  }
}

async function main() {
  const program = new Command().name("import-recipes-mongodb");
  program.argument("<csv>").option("--batch-size <count>", "bulk write batch size", Number, 500).option("--limit <count>", "bounded smoke import", Number).option("--run-id <id>");
  program.action(async (csv, options) => { process.stdout.write(`${JSON.stringify(await importCatalog(resolve(csv), options), null, 2)}\n`); });
  await program.parseAsync();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error); process.exitCode = 1; });

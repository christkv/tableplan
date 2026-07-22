#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BSON, type AnyBulkWriteOperation, type Db, type Document } from "mongodb";
import { Command } from "commander";
import { parse } from "csv-parse";

import { createMongoRuntime, type MongoConnectionConfig } from "../gateway/mongo";
import { refreshCatalogRecipeFacets } from "../gateway/recipes";
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

export function resolveImportDatabase(database: string, allowProduction = false): string {
  const value = database.trim();
  if (!value) throw new Error("MongoDB database name is required");
  if (value === "application" && !allowProduction) {
    throw new Error("Importing into production requires --allow-production");
  }
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function importerMongoConfig(database: string): MongoConnectionConfig {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI is required");
  return {
    MONGODB_URI: uri,
    MONGODB_DATABASE: database,
    MONGODB_MAX_POOL_SIZE: Math.min(positiveInteger(process.env.MONGODB_MAX_POOL_SIZE, 4, "MONGODB_MAX_POOL_SIZE"), 4),
    MONGODB_MIN_POOL_SIZE: 0,
    MONGODB_MAX_IDLE_TIME_MS: positiveInteger(process.env.MONGODB_MAX_IDLE_TIME_MS, 60_000, "MONGODB_MAX_IDLE_TIME_MS"),
    MONGODB_WAIT_QUEUE_TIMEOUT_MS: positiveInteger(process.env.MONGODB_WAIT_QUEUE_TIMEOUT_MS, 2_000, "MONGODB_WAIT_QUEUE_TIMEOUT_MS"),
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: positiveInteger(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 3_000, "MONGODB_SERVER_SELECTION_TIMEOUT_MS"),
    MONGODB_MAX_CONNECTING: Math.min(positiveInteger(process.env.MONGODB_MAX_CONNECTING, 2, "MONGODB_MAX_CONNECTING"), 2),
  };
}

export async function importCatalog(sourcePath: string, options: { batchSize: number; limit?: number; runId?: string; database?: string; allowProduction?: boolean }) {
  if (!existsSync(sourcePath)) throw new Error(`Source file not found: ${sourcePath}`);
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 1_000) throw new Error("Batch size must be between 1 and 1000");
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) throw new Error("Limit must be a positive integer");
  const databaseName = resolveImportDatabase(options.database ?? process.env.MONGODB_DATABASE ?? "application_local", options.allowProduction);
  const sourceHash = await sha256(sourcePath);
  const sourceSize = statSync(sourcePath).size;
  const mongo = createMongoRuntime(importerMongoConfig(databaseName));
  await mongo.connect();
  const database = mongo.database;
  const runId = options.runId ?? `catalog_${sourceHash.slice(0, 16)}`;
  const runs = database.collection<StringDocument & { checkpointRow?: number; status?: string }>("import_runs");
  const previous = await runs.findOne({ _id: runId });
  const checkpoint = previous?.checkpointRow ?? 0;
  await runs.updateOne({ _id: runId }, { $set: {
    sourcePath, sourceHash, sourceSize, importerVersion: IMPORTER_VERSION,
    status: "running", resumedAt: new Date(),
  }, $setOnInsert: { startedAt: new Date(), rowsImported: 0, rowsRejected: 0 } }, { upsert: true });
  await database.collection<StringDocument>("units").bulkWrite(UNITS.map((unit) => ({ updateOne: { filter: { _id: unit.id }, update: { $set: { canonicalName: unit.name, symbol: unit.symbol, dimension: unit.dimension, toBaseFactor: unit.toBase, system: unit.system } }, upsert: true } })), { ordered: false });

  let rowNumber = 0; let imported = 0; let rejected = 0; let pendingRows = 0; let limited = false; let batch = emptyBatch();
  const seen = new Set<string>();
  try {
    for await (const row of records(sourcePath)) {
      if (options.limit && imported >= options.limit) { limited = true; break; }
      rowNumber += 1;
      const sourceId = row.id.trim();
      const duplicate = seen.has(sourceId);
      seen.add(sourceId);
      if (rowNumber <= checkpoint) continue;
      pendingRows += 1;
      if (duplicate) {
        rejected += 1;
        batch.issues.push({ updateOne: { filter: { _id: `${runId}_${rowNumber}_duplicate` }, update: { $set: { importRunId: runId, sourceRecipeId: sourceId, rowNumber, field: "id", severity: "error", reasonCode: "duplicate_source_id" } }, upsert: true } });
      } else {
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
      }
      if (pendingRows >= options.batchSize) {
        await flush(database, batch);
        await runs.updateOne({ _id: runId }, { $set: { checkpointRow: rowNumber, updatedAt: new Date() }, $inc: { rowsImported: batch.recipes.length, rowsRejected: rejected } });
        batch = emptyBatch(); rejected = 0; pendingRows = 0;
      }
    }
    await flush(database, batch);
    await refreshCatalogRecipeFacets(database);
    await runs.updateOne({ _id: runId }, {
      $set: { checkpointRow: rowNumber, status: limited ? "paused" : "completed", updatedAt: new Date(), ...(limited ? {} : { completedAt: new Date() }) },
      $inc: { rowsImported: batch.recipes.length, rowsRejected: rejected },
    });
    return { runId, database: databaseName, sourceHash, checkpointRow: rowNumber, imported, status: limited ? "paused" : "completed" };
  } catch (error) {
    await runs.updateOne({ _id: runId }, { $set: { status: "failed", checkpointRow: rowNumber, failedAt: new Date(), errorCode: "catalog_import_failed" } });
    throw error;
  } finally {
    await mongo.close();
  }
}

async function main() {
  const program = new Command().name("import-recipes-mongodb");
  program.argument("<csv>")
    .option("--database <name>", "MongoDB database (application_local, application_preview, or application)")
    .option("--batch-size <count>", "bulk write batch size", Number, 500)
    .option("--limit <count>", "pause after importing this many rows", Number)
    .option("--run-id <id>")
    .option("--allow-production", "confirm writes to the application production database", false);
  program.action(async (csv, options) => { process.stdout.write(`${JSON.stringify(await importCatalog(resolve(csv), options), null, 2)}\n`); });
  await program.parseAsync();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error); process.exitCode = 1; });

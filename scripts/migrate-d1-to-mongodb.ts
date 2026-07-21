#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { Command } from "commander";
import type { Db, Document } from "mongodb";

import { loadGatewayConfig } from "../gateway/config";
import { createMongoRuntime } from "../gateway/mongo";

type Row = Record<string, unknown>;
type TargetDocument = Document & { _id: string };

const TABLES = [
  "user", "session", "account", "verification", "households", "household_members", "user_profiles", "household_preferences",
  "favorites", "collections", "collection_recipes", "meal_plans", "meal_plan_items", "shopping_lists", "shopping_list_items",
  "saved_recipe_searches", "api_keys", "api_key_events", "recipe_ingestions", "recipe_source_artifacts", "recipe_ingestion_drafts",
  "recipe_ingestion_ingredient_reviews", "household_ingredient_aliases", "recipe_mutation_events", "shopping_list_shares", "email_deliveries",
  "household_invitations", "import_runs", "import_issues", "import_metrics",
  "recipes", "recipe_steps", "recipe_ingredients", "tags", "recipe_tags", "ingredients", "ingredient_aliases", "units",
] as const;

export interface D1Snapshot {
  version: 1;
  createdAt: string;
  source: string;
  collections: Record<string, TargetDocument[]>;
  manifest: Record<string, { count: number; checksum: string }>;
}

const camel = (value: string) => value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const identifier = (row: Row, fallback: string) => String(row.id ?? row.user_id ?? row.token ?? fallback);

function convert(row: Row, fallback: string): TargetDocument {
  const output: Row = { _id: identifier(row, fallback) };
  for (const [key, value] of Object.entries(row)) {
    if (key === "id") continue;
    const target = camel(key);
    if (target.endsWith("At") && typeof value === "string" && !Number.isNaN(Date.parse(value))) output[target] = new Date(value).toISOString();
    else if (target.endsWith("At") && typeof value === "number" && Number.isFinite(value)) output[target] = new Date(value).toISOString();
    else if (["emailVerified"].includes(target)) output[target] = Boolean(value);
    else output[target] = value;
  }
  return output as TargetDocument;
}

function jsonReady(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonReady);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, jsonReady(child)]));
  return value;
}

function checksum(documents: TargetDocument[]) {
  const normalized = documents.map((document) => jsonReady(document) as TargetDocument);
  return createHash("sha256").update(JSON.stringify(normalized.sort((left, right) => left._id.localeCompare(right._id)))).digest("hex");
}

function rows(database: DatabaseSync, table: string): Row[] {
  const exists = database.prepare("SELECT 1 found FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return exists ? database.prepare(`SELECT * FROM "${table}"`).all() as Row[] : [];
}

function grouped(input: Row[], field: string) {
  const result = new Map<string, Row[]>();
  for (const row of input) {
    const key = String(row[field] ?? "");
    result.set(key, [...(result.get(key) ?? []), row]);
  }
  return result;
}

function jsonValue<T>(value: unknown, fallback: T): T {
  try { return typeof value === "string" ? JSON.parse(value) as T : (value as T) ?? fallback; } catch { return fallback; }
}

function embedded(row: Row, fallback: string): Row {
  const value = convert(row, fallback); const { _id, ...rest } = value; return { id: _id, ...rest };
}

export function transformD1Rows(source: Record<string, Row[]>): Record<string, TargetDocument[]> {
  const output: Record<string, TargetDocument[]> = {};
  const direct: Record<string, string> = {
    user: "users", session: "sessions", account: "accounts", verification: "verifications", household_members: "household_memberships",
    user_profiles: "user_profiles", favorites: "favourites", collections: "collections", collection_recipes: "collection_recipes",
    saved_recipe_searches: "saved_recipe_searches", api_keys: "api_keys", api_key_events: "api_key_events",
    household_ingredient_aliases: "ingredient_aliases", recipe_mutation_events: "recipe_mutation_events", shopping_list_shares: "shopping_list_shares",
    email_deliveries: "email_deliveries", household_invitations: "household_invitations", import_issues: "import_issues",
  };
  for (const [table, collection] of Object.entries(direct)) {
    output[collection] = (source[table] ?? []).map((row, index) => convert(row, `${table}_${index}`));
  }

  output.household_memberships = (source.household_members ?? []).map((row) => ({ ...convert(row, `${row.household_id}:${row.user_id}`), _id: `${row.household_id}:${row.user_id}`, roleOrder: row.role === "owner" ? 0 : row.role === "adult" ? 1 : 2 }));
  output.favourites = (source.favorites ?? []).map((row) => ({ ...convert(row, `${row.user_id}:${row.recipe_id}`), _id: `${row.user_id}:${row.recipe_id}` }));
  output.collection_recipes = (source.collection_recipes ?? []).map((row) => ({ ...convert(row, `${row.collection_id}:${row.recipe_id}`), _id: `${row.collection_id}:${row.recipe_id}` }));
  output.api_keys = (source.api_keys ?? []).map((row, index) => { const value = convert(row, `api_key_${index}`); return { ...value, prefix: value.keyPrefix, scopes: jsonValue(value.scopesJson, []), expiresAt: value.expiresAt ?? null, revokedAt: value.revokedAt ?? null, lastUsedAt: value.lastUsedAt ?? null }; });
  output.shopping_list_shares = (source.shopping_list_shares ?? []).map((row, index) => { const value = convert(row, `share_${index}`); return { ...value, listId: value.shoppingListId }; });
  output.household_invitations = (source.household_invitations ?? []).map((row, index) => { const value = convert(row, `invitation_${index}`); return { ...value, email: value.invitedEmail, normalizedEmail: value.invitedEmail, deliveryAttemptCount: Number(value.deliveryAttemptCount ?? 0) }; });
  output.ingredient_aliases = [
    ...(source.ingredient_aliases ?? []).map((row, index) => { const value = convert(row, `global_alias_${index}`); return { ...value, _id: `global:${value.alias ?? index}`, householdId: null, normalizedAlias: value.alias }; }),
    ...(source.household_ingredient_aliases ?? []).map((row, index) => { const value = convert(row, `household_alias_${index}`); return { ...value, _id: `${value.householdId}:${value.alias ?? index}`, normalizedAlias: value.alias }; }),
  ];

  const preferences = new Map((source.household_preferences ?? []).map((row) => [String(row.household_id), convert(row, String(row.household_id))]));
  output.households = (source.households ?? []).map((row, index) => ({ ...convert(row, `household_${index}`), preferences: preferences.get(String(row.id)) ?? null }));

  const planItems = grouped(source.meal_plan_items ?? [], "meal_plan_id");
  output.meal_plans = (source.meal_plans ?? []).map((row, index) => ({ ...convert(row, `plan_${index}`), items: (planItems.get(String(row.id)) ?? []).map((item, itemIndex) => ({ ...embedded(item, `${row.id}_item_${itemIndex}`), servings: Number(item.servings), leftovers: Boolean(item.leftovers) })) }));

  const listItems = grouped(source.shopping_list_items ?? [], "shopping_list_id");
  output.shopping_lists = (source.shopping_lists ?? []).map((row, index) => { const value = convert(row, `list_${index}`); return { ...value, planId: value.mealPlanId, items: (listItems.get(String(row.id)) ?? []).map((item, itemIndex) => { const embeddedItem = embedded(item, `${row.id}_item_${itemIndex}`); return { ...embeddedItem, canonicalIngredientId: embeddedItem.ingredientId, name: embeddedItem.displayName, checked: Boolean(embeddedItem.checked), unresolved: Boolean(embeddedItem.unresolved), sources: jsonValue(embeddedItem.sourceJson, []) }; }) }; });

  const artifacts = grouped(source.recipe_source_artifacts ?? [], "ingestion_id");
  const drafts = grouped(source.recipe_ingestion_drafts ?? [], "ingestion_id");
  const reviews = grouped(source.recipe_ingestion_ingredient_reviews ?? [], "ingestion_id");
  output.recipe_ingestions = (source.recipe_ingestions ?? []).map((row, index) => {
    const artifact = artifacts.get(String(row.id))?.[0]; const rawDraft = drafts.get(String(row.id))?.[0];
    return { ...convert(row, `ingestion_${index}`), sourceArtifact: artifact ? { ...embedded(artifact, `${row.id}_artifact`), key: artifact.r2_key, mediaType: artifact.media_type, byteSize: artifact.byte_size } : null, draft: rawDraft ? { title: rawDraft.title, description: rawDraft.description ?? "", servings: rawDraft.servings, servingSize: rawDraft.serving_size, ingredients: jsonValue(rawDraft.ingredients_json, []), steps: jsonValue(rawDraft.steps_json, []), tags: jsonValue(rawDraft.tags_json, []), warnings: jsonValue(rawDraft.warnings_json, []) } : null, ingredientReviews: (reviews.get(String(row.id)) ?? []).map((item) => ({ position: Number(item.position), rawLine: item.raw_line, parsedName: item.parsed_name, ingredientId: item.ingredient_id, mappingStatus: item.mapping_status, mappingConfidence: Number(item.mapping_confidence), rememberAlias: Boolean(item.remember_alias) })) };
  });

  const steps = grouped(source.recipe_steps ?? [], "recipe_id"); const recipeIngredients = grouped(source.recipe_ingredients ?? [], "recipe_id"); const recipeTags = grouped(source.recipe_tags ?? [], "recipe_id"); const tagNames = new Map((source.tags ?? []).map((tag) => [String(tag.id), String(tag.name)]));
  output.recipes = (source.recipes ?? []).filter((recipe) => recipe.visibility !== "catalog").map((recipe, index) => ({ ...convert(recipe, `recipe_${index}`), qualityFlags: jsonValue(recipe.quality_flags_json, []), tags: (recipeTags.get(String(recipe.id)) ?? []).map((link) => tagNames.get(String(link.tag_id))).filter(Boolean), recipeIngredients: (recipeIngredients.get(String(recipe.id)) ?? []).map((item, itemIndex) => ({ ...embedded(item, `${recipe.id}_ingredient_${itemIndex}`), canonicalIngredientId: item.ingredient_id, ingredient: item.ingredient_text, rawLine: item.raw_line, quantityMin: item.quantity_min, quantityMax: item.quantity_max, unitId: item.unit_id, parseStatus: item.parse_status, parseConfidence: Number(item.parse_confidence) })), steps: (steps.get(String(recipe.id)) ?? []).map((step) => ({ position: Number(step.position), instruction: step.instruction, parseStatus: step.parse_status })) }));

  const metrics = grouped(source.import_metrics ?? [], "import_run_id");
  output.import_runs = (source.import_runs ?? []).map((row, index) => ({ ...convert(row, `run_${index}`), metrics: (metrics.get(String(row.id)) ?? []).map((item) => ({ name: item.metric_name, value: item.metric_value })) }));
  return output;
}

export function createSnapshot(databasePath: string): D1Snapshot {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const source = Object.fromEntries(TABLES.map((table) => [table, rows(database, table)]));
    const collections = transformD1Rows(source);
    return {
      version: 1, createdAt: new Date().toISOString(), source: basename(databasePath), collections,
      manifest: Object.fromEntries(Object.entries(collections).map(([name, documents]) => [name, { count: documents.length, checksum: checksum(documents) }])),
    };
  } finally { database.close(); }
}

export async function loadSnapshot(database: Db, snapshot: D1Snapshot, batchSize = 500) {
  for (const [name, documents] of Object.entries(snapshot.collections)) {
    const collection = database.collection<TargetDocument>(name);
    for (let offset = 0; offset < documents.length; offset += batchSize) {
      await collection.bulkWrite(documents.slice(offset, offset + batchSize).map((document) => ({ replaceOne: { filter: { _id: document._id }, replacement: reviveMongoDates(document) as TargetDocument, upsert: true } })), { ordered: false });
    }
  }
}

export function reviveMongoDates(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => reviveMongoDates(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, reviveMongoDates(child, childKey)]));
  // Date-only domain fields such as plannedDate, startsOn, and endsOn must remain strings.
  // Only timestamp fields use the `*At` convention and become BSON Date values.
  if (typeof value === "string" && /At$/.test(key) && !Number.isNaN(Date.parse(value))) return new Date(value);
  return value;
}

interface VerificationCollectionResult {
  expected: number;
  found: number;
  missing: number;
  expectedChecksum: string;
  foundChecksum: string;
  checksumMatches: boolean;
}

async function countMissingReferences(database: Db, snapshot: D1Snapshot) {
  const ids = (name: string) => (snapshot.collections[name] ?? []).map((document) => document._id);
  const lookupCount = async (source: string, sourceIds: string[], localField: string, target: string, foreignField = "_id") => {
    if (!sourceIds.length) return 0;
    const rows = await database.collection(source).aggregate<{ count: number }>([
      { $match: { _id: { $in: sourceIds }, [localField]: { $exists: true, $nin: [null, ""] } } },
      { $lookup: { from: target, localField, foreignField, as: "_migrationReference" } },
      { $match: { _migrationReference: { $size: 0 } } },
      { $count: "count" },
    ]).toArray();
    return rows[0]?.count ?? 0;
  };
  const embeddedRecipeCount = async (source: string, sourceIds: string[], path: string) => {
    if (!sourceIds.length) return 0;
    const rows = await database.collection(source).aggregate<{ count: number }>([
      { $match: { _id: { $in: sourceIds } } },
      { $unwind: `$${path.split(".")[0]}` },
      { $match: { [path]: { $nin: [null, ""] } } },
      { $lookup: { from: "recipes", localField: path, foreignField: "_id", as: "_migrationReference" } },
      { $match: { _migrationReference: { $size: 0 } } },
      { $count: "count" },
    ]).toArray();
    return rows[0]?.count ?? 0;
  };

  const checks = {
    membershipHousehold: lookupCount("household_memberships", ids("household_memberships"), "householdId", "households"),
    membershipUser: lookupCount("household_memberships", ids("household_memberships"), "userId", "users"),
    favouriteUser: lookupCount("favourites", ids("favourites"), "userId", "users"),
    favouriteRecipe: lookupCount("favourites", ids("favourites"), "recipeId", "recipes"),
    mealPlanHousehold: lookupCount("meal_plans", ids("meal_plans"), "householdId", "households"),
    mealPlanRecipe: embeddedRecipeCount("meal_plans", ids("meal_plans"), "items.recipeId"),
    shoppingListHousehold: lookupCount("shopping_lists", ids("shopping_lists"), "householdId", "households"),
    shoppingListPlan: lookupCount("shopping_lists", ids("shopping_lists"), "planId", "meal_plans"),
    shareList: lookupCount("shopping_list_shares", ids("shopping_list_shares"), "listId", "shopping_lists"),
    invitationHousehold: lookupCount("household_invitations", ids("household_invitations"), "householdId", "households"),
    invitationInviter: lookupCount("household_invitations", ids("household_invitations"), "invitedByUserId", "users"),
    apiKeyUser: lookupCount("api_keys", ids("api_keys"), "userId", "users"),
    apiKeyHousehold: lookupCount("api_keys", ids("api_keys"), "householdId", "households"),
    ingestionUser: lookupCount("recipe_ingestions", ids("recipe_ingestions"), "userId", "users"),
    ingestionHousehold: lookupCount("recipe_ingestions", ids("recipe_ingestions"), "householdId", "households"),
    emailList: lookupCount("email_deliveries", ids("email_deliveries"), "shoppingListId", "shopping_lists"),
    emailShare: lookupCount("email_deliveries", ids("email_deliveries"), "shareId", "shopping_list_shares"),
  };
  return Object.fromEntries(await Promise.all(Object.entries(checks).map(async ([name, pending]) => [name, await pending])));
}

export async function verifySnapshot(database: Db, snapshot: D1Snapshot) {
  const collections: Record<string, VerificationCollectionResult> = {};
  for (const [name, documents] of Object.entries(snapshot.collections)) {
    const ids = documents.map((document) => document._id);
    const foundDocuments = ids.length ? await database.collection<TargetDocument>(name).find({ _id: { $in: ids } }).toArray() : [];
    const expectedChecksum = snapshot.manifest[name]?.checksum ?? checksum(documents);
    const foundChecksum = checksum(foundDocuments);
    collections[name] = { expected: ids.length, found: foundDocuments.length, missing: ids.length - foundDocuments.length, expectedChecksum, foundChecksum, checksumMatches: expectedChecksum === foundChecksum };
  }
  const orphanReferences = await countMissingReferences(database, snapshot);
  const ok = Object.values(collections).every((result) => result.missing === 0 && result.checksumMatches)
    && Object.values(orphanReferences).every((count) => count === 0);
  return { ok, collections, orphanReferences };
}

async function withMongo<T>(operation: (database: Db) => Promise<T>) {
  const mongo = createMongoRuntime(loadGatewayConfig(process.env));
  await mongo.connect();
  try { return await operation(mongo.database); } finally { await mongo.close(); }
}

async function main() {
  const program = new Command().name("migrate-d1-to-mongodb");
  program.command("materialize").argument("<sql>").requiredOption("--out <sqlite>").action((sql, options) => {
    const database = new DatabaseSync(resolve(options.out));
    try { database.exec(readFileSync(resolve(sql), "utf8")); } finally { database.close(); }
  });
  program.command("snapshot").argument("<sqlite>").requiredOption("--out <json>").action((sqlite, options) => {
    const destination = resolve(options.out); mkdirSync(resolve(destination, ".."), { recursive: true });
    writeFileSync(destination, `${JSON.stringify(createSnapshot(resolve(sqlite)))}\n`, { mode: 0o600 });
  });
  program.command("load").argument("<snapshot>").option("--batch-size <count>", "batch size", Number, 500).action(async (path, options) => {
    const snapshot = JSON.parse(readFileSync(resolve(path), "utf8")) as D1Snapshot;
    await withMongo((database) => loadSnapshot(database, snapshot, options.batchSize));
  });
  program.command("verify").argument("<snapshot>").action(async (path) => {
    const snapshot = JSON.parse(readFileSync(resolve(path), "utf8")) as D1Snapshot;
    const result = await withMongo((database) => verifySnapshot(database, snapshot));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  });
  await program.parseAsync();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error); process.exitCode = 1; });

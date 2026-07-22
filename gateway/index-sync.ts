import type { Db, IndexDescription, IndexDescriptionInfo, IndexSpecification } from "mongodb";

import type { CollectionDefinition } from "./schema";

export type IndexSyncAction =
  | { type: "create"; index: IndexDescription; reason: "missing" | "changed" | "renamed" }
  | { type: "drop"; indexName: string; reason: "changed" | "renamed" | "obsolete" };

export interface IndexSyncSummary {
  collections: number;
  created: number;
  dropped: number;
  unchanged: number;
}

const comparableOptions = ["unique", "sparse", "expireAfterSeconds", "partialFilterExpression", "collation", "hidden", "wildcardProjection"] as const;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
}

function keyEntries(key: IndexSpecification): [string, unknown][] {
  if (typeof key === "string") return [[key, 1]];
  if (Array.isArray(key)) return key.map((entry) => Array.isArray(entry) ? [String(entry[0]), entry[1]] : [String(entry), 1]);
  return Object.entries(key);
}

function optionValue(index: IndexDescription | IndexDescriptionInfo, option: typeof comparableOptions[number]): unknown {
  const value = index[option as keyof typeof index];
  if (option === "unique" || option === "sparse" || option === "hidden") return Boolean(value);
  return value ?? null;
}

export function indexesMatch(expected: IndexDescription, actual: IndexDescriptionInfo): boolean {
  if (JSON.stringify(keyEntries(expected.key)) !== JSON.stringify(keyEntries(actual.key))) return false;
  return comparableOptions.every((option) => JSON.stringify(stableValue(optionValue(expected, option))) === JSON.stringify(stableValue(optionValue(actual, option))));
}

export function planCollectionIndexSync(expected: IndexDescription[], actual: IndexDescriptionInfo[]): IndexSyncAction[] {
  const existing = actual.filter((index): index is IndexDescriptionInfo & { name: string } => typeof index.name === "string" && index.name !== "_id_");
  const expectedNames = new Set(expected.map((index) => {
    if (!index.name) throw new Error("Every managed MongoDB index must have an explicit name");
    return index.name;
  }));
  const satisfied = new Set<string>();
  const preDrops: IndexSyncAction[] = [];
  const immediateCreates: IndexSyncAction[] = [];
  const replacementCreates: IndexSyncAction[] = [];
  const droppedBeforeCreate = new Set<string>();

  for (const index of expected) {
    const name = String(index.name);
    const sameName = existing.find((candidate) => candidate.name === name);
    if (sameName && indexesMatch(index, sameName)) {
      satisfied.add(name);
      continue;
    }
    if (sameName) {
      preDrops.push({ type: "drop", indexName: name, reason: "changed" });
      droppedBeforeCreate.add(name);
      const equivalent = existing.find((candidate) => candidate.name !== name && indexesMatch(index, candidate));
      if (equivalent) {
        preDrops.push({ type: "drop", indexName: equivalent.name, reason: "renamed" });
        droppedBeforeCreate.add(equivalent.name);
      }
      replacementCreates.push({ type: "create", index, reason: "changed" });
      continue;
    }
    const equivalent = existing.find((candidate) => indexesMatch(index, candidate));
    if (equivalent) {
      preDrops.push({ type: "drop", indexName: equivalent.name, reason: "renamed" });
      droppedBeforeCreate.add(equivalent.name);
      replacementCreates.push({ type: "create", index, reason: "renamed" });
      continue;
    }
    immediateCreates.push({ type: "create", index, reason: "missing" });
  }

  const obsoleteDrops: IndexSyncAction[] = existing
    .filter((index) => !expectedNames.has(index.name) && !droppedBeforeCreate.has(index.name))
    .map((index) => ({ type: "drop" as const, indexName: index.name, reason: "obsolete" as const }));

  return [...immediateCreates, ...preDrops, ...replacementCreates, ...obsoleteDrops];
}

export async function syncMongoIndexes(database: Db, definitions: CollectionDefinition[], options: { dryRun?: boolean; log?: (message: string) => void } = {}): Promise<IndexSyncSummary> {
  const log = options.log ?? (() => undefined);
  const existingCollections = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
  const summary: IndexSyncSummary = { collections: definitions.length, created: 0, dropped: 0, unchanged: 0 };

  for (const definition of definitions) {
    if (!existingCollections.has(definition.name)) {
      log(`create collection ${definition.name}`);
      if (!options.dryRun) await database.createCollection(definition.name, definition.validator ? { validator: definition.validator, validationLevel: "moderate", validationAction: "error" } : undefined);
    }
    const collection = database.collection(definition.name);
    const actual = existingCollections.has(definition.name) ? await collection.listIndexes().toArray() : [{ name: "_id_", key: { _id: 1 }, v: 2 } as IndexDescriptionInfo];
    const actions = planCollectionIndexSync(definition.indexes, actual);
    summary.unchanged += definition.indexes.length - actions.filter((action) => action.type === "create").length;

    for (const action of actions) {
      if (action.type === "create") {
        log(`create ${definition.name}.${String(action.index.name)} (${action.reason})`);
        summary.created += 1;
        if (!options.dryRun) await collection.createIndexes([action.index]);
      } else {
        log(`drop ${definition.name}.${action.indexName} (${action.reason})`);
        summary.dropped += 1;
        if (!options.dryRun) await collection.dropIndex(action.indexName);
      }
    }
  }
  return summary;
}

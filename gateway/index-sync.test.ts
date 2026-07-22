import { describe, expect, it } from "vitest";

import { indexesMatch, planCollectionIndexSync } from "./index-sync";
import { collectionDefinitions } from "./schema";

const actual = (name: string, key: Record<string, number>, options: Record<string, unknown> = {}) => ({ v: 2, name, key, ...options });

describe("MongoDB index synchronization", () => {
  it("keeps authentication error diagnostics bounded with a TTL index", () => {
    const definition = collectionDefinitions.find((collection) => collection.name === "auth_error_events");
    expect(definition?.indexes).toContainEqual({ key: { expiresAt: 1 }, name: "auth_error_expiry", expireAfterSeconds: 0 });
  });

  it("recognizes equivalent index definitions while ignoring server metadata", () => {
    expect(indexesMatch(
      { name: "lookup", key: { householdId: 1, createdAt: -1 }, unique: true },
      actual("lookup", { householdId: 1, createdAt: -1 }, { unique: true }) as never,
    )).toBe(true);
  });

  it("creates missing indexes and drops obsolete indexes", () => {
    expect(planCollectionIndexSync(
      [{ name: "current", key: { status: 1 } }, { name: "new_lookup", key: { ownerId: 1 } }],
      [actual("_id_", { _id: 1 }), actual("current", { status: 1 }), actual("old_lookup", { legacy: 1 })] as never,
    )).toEqual([
      { type: "create", index: { name: "new_lookup", key: { ownerId: 1 } }, reason: "missing" },
      { type: "drop", indexName: "old_lookup", reason: "obsolete" },
    ]);
  });

  it("drops and rebuilds an index whose options changed", () => {
    expect(planCollectionIndexSync(
      [{ name: "expiry", key: { expiresAt: 1 }, expireAfterSeconds: 0 }],
      [actual("_id_", { _id: 1 }), actual("expiry", { expiresAt: 1 })] as never,
    )).toEqual([
      { type: "drop", indexName: "expiry", reason: "changed" },
      { type: "create", index: { name: "expiry", key: { expiresAt: 1 }, expireAfterSeconds: 0 }, reason: "changed" },
    ]);
  });

  it("replaces an equivalent index that has the wrong name and preserves _id_", () => {
    expect(planCollectionIndexSync(
      [{ name: "preferred_name", key: { email: 1 }, unique: true }],
      [actual("_id_", { _id: 1 }), actual("generated_name", { email: 1 }, { unique: true })] as never,
    )).toEqual([
      { type: "drop", indexName: "generated_name", reason: "renamed" },
      { type: "create", index: { name: "preferred_name", key: { email: 1 }, unique: true }, reason: "renamed" },
    ]);
  });
});

import { describe, expect, it, vi } from "vitest";

import { mongoCommandContext } from "./mongo";
import { createLogger } from "../src/observability/logger";

describe("MongoDB command logging", () => {
  it("reports the actual query in command completion events", () => {
    const context = mongoCommandContext({
      commandName: "find",
      databaseName: "application_local",
      requestId: 42,
      connectionId: 7,
      command: {
        find: "recipes",
        filter: { ownerUserId: "private-user", name: "private recipe" },
      },
    });

    expect(context).toMatchObject({
      command: "find",
      database: "application_local",
      collection: "recipes",
      requestId: 42,
      connectionId: 7,
      query: {
        find: "recipes",
        filter: { ownerUserId: "private-user", name: "private recipe" },
      },
    });
  });

  it("recursively redacts authentication material from logged commands", () => {
    const context = mongoCommandContext({
      commandName: "update",
      databaseName: "application_local",
      requestId: 43,
      connectionId: 7,
      command: {
        update: "users",
        updates: [{
          q: { email: "cook@example.test", sessionToken: "find-me" },
          u: { $set: { name: "Cook", passwordHash: "hash-me", profile: { apiKey: "key-me" } } },
        }],
      },
    });

    expect(context.query).toEqual({
      update: "users",
      updates: [{
        q: { email: "cook@example.test", sessionToken: "[REDACTED]" },
        u: { $set: { name: "Cook", passwordHash: "[REDACTED]", profile: { apiKey: "[REDACTED]" } } },
      }],
    });
    expect(JSON.stringify(context)).not.toContain("find-me");
    expect(JSON.stringify(context)).not.toContain("hash-me");
    expect(JSON.stringify(context)).not.toContain("key-me");
  });

  it("fully expands aggregation pipelines in Node console output", () => {
    const context = mongoCommandContext({
      commandName: "aggregate",
      databaseName: "application_local",
      requestId: 44,
      connectionId: 7,
      command: {
        aggregate: "recipes",
        pipeline: [
          { $match: { status: "active", tags: { $all: ["quick", "family"] } } },
          { $group: { _id: "$origin", count: { $sum: 1 }, names: { $push: "$name" } } },
          { $sort: { count: -1 } },
        ],
        cursor: {},
      },
    });

    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    createLogger({ LOG_LEVEL: "DEBUG" }, "mongodb").debug("command.succeeded", { ...context, durationMs: 1 });
    expect(debug).toHaveBeenCalledOnce();
    const consoleOutput = String(debug.mock.calls[0][0]);
    expect(consoleOutput).toContain('"pipeline": [');
    expect(consoleOutput).toContain('"$match": {');
    expect(consoleOutput).toContain('"$group": {');
    expect(consoleOutput).toContain('"$sort": {');
    expect(consoleOutput).toContain('"$all": [');
    expect(consoleOutput).not.toContain("[Object]");
    expect(consoleOutput).not.toContain("[Array]");
    expect(debug.mock.calls[0]).toHaveLength(1);
    debug.mockRestore();
  });
});

import { describe, expect, it } from "vitest";

import { authTrustedOrigins, ensureUserHousehold } from "./server";

function householdDb(results: { preferred?: string; membership?: string }) {
  const batches: unknown[][] = [];
  const db = {
    prepare(query: string) {
      return {
        bind() { return this; },
        async first() {
          if (query.includes("FROM user_profiles up")) return results.preferred ? { household_id: results.preferred } : null;
          if (query.includes("FROM household_members WHERE")) return results.membership ? { household_id: results.membership } : null;
          return null;
        },
      };
    },
    async batch(statements: unknown[]) { batches.push(statements); return []; },
  };
  return { db: db as unknown as D1Database, batches };
}

describe("authTrustedOrigins", () => {
  it("accepts loopback hostnames on any local development port", () => {
    expect(authTrustedOrigins("local", "http://localhost:5173")).toEqual([
      "http://localhost:*",
      "http://127.0.0.1:*",
      "http://[::1]:*",
    ]);
  });

  it("restricts deployed environments to the configured origin", () => {
    expect(authTrustedOrigins("production", "https://tableplan.example/path")).toEqual([
      "https://tableplan.example",
    ]);
  });
});

describe("ensureUserHousehold", () => {
  it("keeps a valid default household without creating another", async () => {
    const fake = householdDb({ preferred: "household-invited" });
    await expect(ensureUserHousehold(fake.db, { id: "user-1", name: "Jamie" })).resolves.toBe("household-invited");
    expect(fake.batches).toHaveLength(0);
  });

  it("adopts an existing invited membership when no default is set", async () => {
    const fake = householdDb({ membership: "household-family" });
    await expect(ensureUserHousehold(fake.db, { id: "user-1", name: "Jamie" })).resolves.toBe("household-family");
    expect(fake.batches).toHaveLength(1);
    expect(fake.batches[0]).toHaveLength(2);
  });
});

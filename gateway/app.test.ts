import { describe, expect, it, vi } from "vitest";

import { createGatewayHandler } from "./app";
import { MONGO_GATEWAY_PROTOCOL_VERSION } from "../src/storage/mongo-protocol";

const token = "a-secure-test-service-token-at-least-32-chars";

function request(operation: string, args: Record<string, unknown> = {}, overrides: RequestInit = {}) {
  return new Request("https://gateway.example.test/v1/mongodb", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ version: MONGO_GATEWAY_PROTOCOL_VERSION, requestId: "request-1", operation, ...(operation === "ping" ? {} : { collection: "recipes" }), args }),
    ...overrides,
  });
}

function database() {
  const collection = {
    findOne: vi.fn(async () => ({ _id: "recipe-1", createdAt: new Date("2026-07-23T00:00:00.000Z") })),
    find: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
    aggregate: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
    countDocuments: vi.fn(async () => 0),
    distinct: vi.fn(async () => []),
    insertOne: vi.fn(async () => ({ insertedId: "recipe-1" })),
    insertMany: vi.fn(async () => ({ insertedIds: { 0: "recipe-1" }, insertedCount: 1 })),
    updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null })),
    updateMany: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null })),
    replaceOne: vi.fn(), findOneAndUpdate: vi.fn(), findOneAndDelete: vi.fn(), findOneAndReplace: vi.fn(),
    deleteOne: vi.fn(async () => ({ deletedCount: 1 })), deleteMany: vi.fn(async () => ({ deletedCount: 1 })), bulkWrite: vi.fn(),
  };
  return { collection, db: { collection: vi.fn(() => collection), command: vi.fn(async () => ({ ok: 1 })) } };
}

describe("operations-only MongoDB gateway", () => {
  it("executes a find and preserves BSON dates in the response", async () => {
    const fixture = database();
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 4096, database: fixture.db as never, ping: vi.fn() });
    const response = await handler(request("findOne", { filter: { _id: "recipe-1" } }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, result: { _id: "recipe-1", createdAt: { $date: "2026-07-23T00:00:00.000Z" } } });
    expect(fixture.collection.findOne).toHaveBeenCalledWith({ _id: "recipe-1" }, {});
  });

  it("supports batch insert using insertMany", async () => {
    const fixture = database();
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 4096, database: fixture.db as never, ping: vi.fn() });
    const response = await handler(request("insertMany", { documents: [{ _id: "recipe-1" }] }));
    expect(response.status).toBe(200);
    expect(fixture.collection.insertMany).toHaveBeenCalledOnce();
  });

  it("rejects missing credentials", async () => {
    const fixture = database();
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 4096, database: fixture.db as never, ping: vi.fn() });
    const response = await handler(request("find", {}, { headers: { "content-type": "application/json" } }));
    expect(response.status).toBe(401);
  });

  it("rejects domain RPC and auth routes", async () => {
    const fixture = database();
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 4096, database: fixture.db as never, ping: vi.fn() });
    expect((await handler(new Request("https://gateway.example.test/v1/rpc", { method: "POST" }))).status).toBe(404);
    expect((await handler(new Request("https://gateway.example.test/api/auth/get-session"))).status).toBe(404);
  });

  it("rejects expired deadlines before touching MongoDB", async () => {
    const fixture = database();
    const handler = createGatewayHandler({ serviceToken: token, maxBodyBytes: 4096, database: fixture.db as never, ping: vi.fn() });
    const body = JSON.stringify({ version: 1, requestId: "expired", deadlineAt: 1, operation: "find", collection: "recipes", args: {} });
    const response = await handler(request("find", {}, { body }));
    expect(response.status).toBe(408);
    expect(fixture.db.collection).not.toHaveBeenCalled();
  });
});

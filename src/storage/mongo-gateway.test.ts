import { describe, expect, it, vi } from "vitest";

import { MongoGatewayClient, MongoGatewayError } from "./mongo-gateway";

describe("MongoGatewayClient", () => {
  it("encodes filters and decodes BSON dates", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      const body = await request.json() as { operation: string; args: { filter: { createdAt: unknown } } };
      expect(body).toMatchObject({ operation: "findOne", args: { filter: { createdAt: { $date: "2026-07-23T00:00:00.000Z" } } } });
      return Response.json({ version: 1, requestId: "response-1", ok: true, result: { _id: "one", createdAt: { $date: "2026-07-23T00:00:00.000Z" } } });
    });
    const client = new MongoGatewayClient({ baseUrl: "https://gateway.test", serviceToken: "secret", fetcher: fetcher as typeof fetch });
    const result = await client.execute<{ createdAt: Date }>("findOne", "recipes", { filter: { createdAt: new Date("2026-07-23T00:00:00.000Z") } });
    expect(result.createdAt).toEqual(new Date("2026-07-23T00:00:00.000Z"));
  });

  it("preserves MongoDB error codes from non-2xx responses", async () => {
    const fetcher = vi.fn(async () => Response.json({
      version: 1,
      requestId: "response-1",
      ok: false,
      error: { name: "MongoServerError", message: "duplicate key", code: 11000, codeName: "DuplicateKey", retryable: false },
    }, { status: 500 }));
    const client = new MongoGatewayClient({ baseUrl: "https://gateway.test", serviceToken: "secret", fetcher: fetcher as typeof fetch });
    await expect(client.execute("insertOne", "accounts", { document: {} })).rejects.toMatchObject({ name: "MongoServerError", code: 11000, codeName: "DuplicateKey" } satisfies Partial<MongoGatewayError>);
  });

  it("reports gateway authentication errors instead of an empty message", async () => {
    const fetcher = vi.fn(async () => Response.json({ error: "unauthorized" }, { status: 401 }));
    const client = new MongoGatewayClient({ baseUrl: "https://gateway.test", serviceToken: "wrong-secret", fetcher: fetcher as typeof fetch });
    await expect(client.execute("insertOne", "verifications", { document: {} })).rejects.toMatchObject({
      name: "MongoGatewayError",
      message: "MongoDB gateway returned HTTP 401: unauthorized",
      retryable: false,
    } satisfies Partial<MongoGatewayError>);
  });
});

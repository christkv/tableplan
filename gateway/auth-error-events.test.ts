import { describe, expect, it, vi } from "vitest";

import { createMongoAuthErrorRecorder } from "./auth-error-events";

describe("MongoDB authentication error recording", () => {
  it("schedules a correlated diagnostic event with a finite retention window", async () => {
    const insertOne = vi.fn(async (_document: Record<string, unknown>) => ({ acknowledged: true }));
    const database = { collection: vi.fn(() => ({ insertOne })) };
    const scheduled: Promise<unknown>[] = [];
    const recorder = createMongoAuthErrorRecorder(database as never, (promise) => scheduled.push(promise), vi.fn());

    const write = recorder({
      requestId: "request-1",
      path: "/api/auth/callback/google",
      source: "better-auth",
      message: "E11000 duplicate key",
      errorCode: 11000,
      errorCodeName: "DuplicateKey",
    });
    await write;

    expect(database.collection).toHaveBeenCalledWith("auth_error_events");
    expect(scheduled).toEqual([write]);
    expect(insertOne).toHaveBeenCalledOnce();
    const document = insertOne.mock.calls[0]![0]!;
    expect(document).toMatchObject({
      requestId: "request-1",
      path: "/api/auth/callback/google",
      source: "better-auth",
      errorCode: 11000,
    });
    expect(document._id).toMatch(/^[0-9a-f-]{36}$/);
    expect((document.expiresAt as Date).getTime() - (document.createdAt as Date).getTime()).toBe(14 * 24 * 60 * 60 * 1_000);
  });

  it("contains persistence failures without rejecting the scheduled task", async () => {
    const failure = new Error("write failed");
    const onFailure = vi.fn();
    const database = { collection: vi.fn(() => ({ insertOne: vi.fn(async () => { throw failure; }) })) };
    const scheduled: Promise<unknown>[] = [];
    const recorder = createMongoAuthErrorRecorder(database as never, (promise) => scheduled.push(promise), onFailure);

    const write = recorder({ requestId: "request-2", path: "/api/auth/callback/google", source: "auth-handler", message: "failed" });
    await expect(write).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledWith(failure);
  });
});

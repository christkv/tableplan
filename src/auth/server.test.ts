import { beforeEach, describe, expect, it, vi } from "vitest";

const { createApplicationAuth } = vi.hoisted(() => ({ createApplicationAuth: vi.fn() }));
vi.mock("./runtime", () => ({ createApplicationAuth }));

import { handleAuthRequest } from "./server";

function runtime(handler: (request: Request) => Promise<Response>) {
  const insertOne = vi.fn(async () => ({ insertedId: "error-1" }));
  return {
    handler,
    flushErrors: vi.fn(async () => undefined),
    database: { collection: vi.fn(() => ({ insertOne })) },
    insertOne,
  };
}

describe("application-owned authentication", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs Better Auth locally and returns mutable response headers", async () => {
    const fixture = runtime(async () => Response.redirect("https://tableplan.example.test/recipes", 302));
    createApplicationAuth.mockReturnValue(fixture);
    const response = await handleAuthRequest(
      new Request("https://tableplan.example.test/api/auth/callback/google"),
      { LOG_LEVEL: "ERROR" } as never,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(302);
    expect(() => response.headers.set("x-router-merged", "true")).not.toThrow();
    expect(fixture.flushErrors).toHaveBeenCalledOnce();
  });

  it("always records Better Auth error responses in MongoDB", async () => {
    const fixture = runtime(async () => Response.redirect("https://tableplan.example.test/auth/error?error=state_mismatch", 302));
    createApplicationAuth.mockReturnValue(fixture);
    const response = await handleAuthRequest(
      new Request("https://tableplan.example.test/api/auth/callback/google"),
      { LOG_LEVEL: "ERROR" } as never,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(302);
    expect(fixture.insertOne).toHaveBeenCalledWith(expect.objectContaining({ source: "oauth-error-response", errorCode: "state_mismatch" }));
  });

  it("records thrown auth errors and redirects OAuth callbacks safely", async () => {
    const fixture = runtime(async () => { throw new Error("mongodb://user:password@private-host"); });
    createApplicationAuth.mockReturnValue(fixture);
    const response = await handleAuthRequest(
      new Request("https://tableplan.example.test/api/auth/callback/google?code=secret"),
      { LOG_LEVEL: "ERROR" } as never,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/auth/error");
    expect(location.searchParams.get("error")).toBe("authentication_failed");
    expect(location.toString()).not.toContain("secret");
    expect(fixture.insertOne).toHaveBeenCalledWith(expect.objectContaining({ source: "auth-handler", errorName: "Error" }));
  });

  it("returns a safe response for non-callback failures", async () => {
    const fixture = runtime(async () => { throw new Error("private credential"); });
    createApplicationAuth.mockReturnValue(fixture);
    const response = await handleAuthRequest(
      new Request("https://tableplan.example.test/api/auth/get-session"),
      { LOG_LEVEL: "ERROR" } as never,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private credential");
  });
});

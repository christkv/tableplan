import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, cachedRequest, invalidateQueryCache } from "./api";

beforeEach(() => {
  invalidateQueryCache();
  vi.unstubAllGlobals();
});

describe("API client errors", () => {
  it("preserves the stable server error code and request ID", () => {
    const error = new ApiClientError(409, "plan_conflict", "Refresh and retry.", "request-1");
    expect(error.status).toBe(409);
    expect(error.code).toBe("plan_conflict");
    expect(error.requestId).toBe("request-1");
    expect(error.message).toBe("Refresh and retry.");
  });
});

describe("cached requests", () => {
  it("deduplicates concurrent reads and reuses the response within its TTL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: 42 }), { headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = cachedRequest<{ value: number }>("/api/value");
    const second = cachedRequest<{ value: number }>("/api/value");

    await expect(Promise.all([first, second])).resolves.toEqual([{ value: 42 }, { value: 42 }]);
    await expect(cachedRequest<{ value: number }>("/api/value")).resolves.toEqual({ value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts failed reads so a retry reaches the server", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "temporary", message: "Try again." }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: 7 }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(cachedRequest("/api/retry")).rejects.toMatchObject({ code: "temporary" });
    await expect(cachedRequest("/api/retry")).resolves.toEqual({ value: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

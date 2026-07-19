import { describe, expect, it } from "vitest";

import { createShareCookie, hashShareToken, parseShareExpiryDays, randomShareToken, shareTokenPrefix } from "./shopping-share";

describe("shopping-list capability material", () => {
  it("creates URL-safe high-entropy tokens and stores a bounded prefix", () => {
    const token = randomShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(shareTokenPrefix(token)).toHaveLength(10);
    expect(randomShareToken()).not.toBe(token);
  });

  it("hashes tokens without retaining token material", async () => {
    const hash = await hashShareToken("private-capability");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("private-capability");
  });

  it("accepts only supported expiration periods", () => {
    expect(parseShareExpiryDays("14")).toBe(14);
    expect(() => parseShareExpiryDays(365)).toThrow(/lifetime/);
  });

  it("uses HttpOnly strict cookies and enables Secure in cloud", () => {
    const cookie = createShareCookie("secret", "2030-01-01T00:00:00.000Z", true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
  });
});

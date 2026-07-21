import { describe, expect, it } from "vitest";

import { createShareCookie, parseShareExpiryDays } from "./shopping-share";

describe("shopping-list capability material", () => {
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

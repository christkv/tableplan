import { describe, expect, it } from "vitest";

import {
  clearInvitationCookie,
  createInvitationCookie,
  hashInvitationToken,
  normalizeInvitationEmail,
  parseHouseholdInviteRole,
  parseHouseholdRelationship,
  randomInvitationToken,
} from "./invitations";

describe("household invitation capabilities", () => {
  it("normalizes email addresses and validates membership metadata", () => {
    expect(normalizeInvitationEmail("  Person@Example.COM ")).toBe("person@example.com");
    expect(parseHouseholdRelationship("child")).toBe("child");
    expect(parseHouseholdInviteRole("adult")).toBe("adult");
    expect(() => normalizeInvitationEmail("not-an-email")).toThrow("valid email");
    expect(() => parseHouseholdRelationship("manager")).toThrow("relationship");
    expect(() => parseHouseholdInviteRole("viewer")).toThrow("household members");
  });

  it("creates URL-safe random tokens and hashes them deterministically", async () => {
    const first = randomInvitationToken();
    const second = randomInvitationToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(second).not.toBe(first);
    expect(await hashInvitationToken(first)).toHaveLength(64);
    expect(await hashInvitationToken(first)).toBe(await hashInvitationToken(first));
    expect(await hashInvitationToken(first)).not.toBe(await hashInvitationToken(second));
  });

  it("keeps invitation credentials in an HttpOnly same-site cookie", () => {
    const cookie = createInvitationCookie("private-token", "2026-07-26T12:00:00.000Z", true);
    expect(cookie).toContain("tableplan_household_invite=private-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(clearInvitationCookie(false)).toContain("Max-Age=0");
  });

});

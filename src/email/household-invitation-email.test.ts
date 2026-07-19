import { describe, expect, it } from "vitest";

import { renderHouseholdInvitationEmail } from "./household-invitation-email";

describe("household invitation email", () => {
  it("renders an escaped HTML message and a plain-text setup link", () => {
    const content = renderHouseholdInvitationEmail({
      householdName: "Cook & Co",
      inviterName: "Sam <Owner>",
      relationship: "flatmate",
      invitationUrl: "https://tableplan.example/household/join#invite=secret",
      expiresAt: "2026-07-26T12:00:00.000Z",
    });
    expect(content.subject).toContain("Cook & Co");
    expect(content.html).toContain("Cook &amp; Co");
    expect(content.html).toContain("Sam &lt;Owner&gt;");
    expect(content.html).toContain("#invite=secret");
    expect(content.text).toContain("as flatmate");
    expect(content.text).toContain("#invite=secret");
  });
});

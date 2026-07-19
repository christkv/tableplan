# Phase 15: Household Accounts and Invitations

**Status (2026-07-19): Implemented locally.** Household membership, owner-only
invitations, local email capture, queued cloud delivery, new-account setup, and
existing-account acceptance pass the local implementation gates. Real outbound
email remains a preview deployment gate.

## Objective

Let a household owner invite a spouse/partner, child, flatmate, or other member
by email. The recipient follows a private link and either creates an account
with a username and password or signs into an account that already owns that
email. The accepted account immediately uses the inviter's household for meal
plans, household recipes, and shopping lists.

## Implemented Flow

1. The owner opens Settings, selects a relationship, and enters an email.
2. D1 stores a seven-day invitation with only a SHA-256 token hash and short
   diagnostic prefix. A newer invitation revokes any pending link for the same
   household/email.
3. Local capture processes the notification immediately and reveals the link in
   Settings. Preview/production enqueue the same message for Cloudflare Email.
4. The email URL stores the raw token in its fragment. Browser code removes the
   fragment and exchanges it for an HttpOnly, SameSite=Lax cookie.
5. A new recipient chooses a name, username, and password. Better Auth creates
   the credential account and session; Tableplan then adds household membership,
   selects that household as the default, and marks the invited email verified.
6. An existing recipient signs in first. Acceptance requires the authenticated
   account email to match the invited email exactly after normalization.
7. The invitation becomes unusable after acceptance or owner revocation.
8. Accounts that belong to multiple households can switch the active household
   from Settings without deleting or hiding their earlier membership data.

## Security and Product Decisions

- Invitation creation/revocation requires the household `owner` role.
- Tokens are random 256-bit capabilities, hashed at rest, never logged, and
  accepted once before expiry.
- The public exchange and join pages are no-store, no-index, frame-denied, and
  use a restrictive content security policy and same-origin POST checks.
- Better Auth owns password validation, hashing, account creation, and session
  cookies. Tableplan never generates or emails temporary passwords.
- Invitation creation is limited to ten per owner/hour and thirty per
  household/day.
- Invited accounts currently receive normal household-member planning access.
  A read-only role is not exposed until write authorization can be enforced
  consistently across UI, REST, MCP, and API-key paths.

## Data Changes

Migration `0007_household_invitations.sql` adds:

- `household_members.relationship` for spouse, child, flatmate, or other.
- `household_invitations` with token, lifecycle, relationship, inviter, expiry,
  acceptance, delivery, and retry metadata.
- Pending-email uniqueness plus token and rate-limit indexes.

The request household resolver now prefers a valid profile default, then any
existing membership, and only creates a personal owner household when neither
exists. This prevents an accepted invite from creating an unrelated household
on first login.

## Verification

- Unit tests cover metadata validation, token/hash/cookie behavior, email HTML
  escaping, email mismatch rejection, and invited-membership resolution.
- Local D1 migration applied to an existing development database.
- Live HTTP smoke created and delivered a captured invitation, exchanged the
  fragment capability, created a password account, joined the owner's household,
  rendered both members in Settings, and returned `410` on token reuse.
- The smoke account and invitation were removed after verification.

## Remaining Preview Gates

- Send a real invitation through the preview Queue and Email binding.
- Inspect HTML/plain-text rendering in major mail clients and test mobile setup.
- Exercise delivery retry/dead-letter handling and verify rate-limit telemetry.
- Add member removal, ownership transfer, and consistently
  enforced restricted-member permissions as separate authorization work.

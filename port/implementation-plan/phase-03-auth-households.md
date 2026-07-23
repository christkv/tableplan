# Phase 03 — Authentication and Households

## Objective

Replace Better Auth and Durable Object sessions with a Tableplan-owned Spring Security
implementation while preserving identity IDs and enforcing household isolation at every
application and repository boundary.

This is a high-risk phase. Password and provider compatibility must be decided from captured
account evidence, not assumptions.

## Scope

- Username/email registration and login, logout, session lookup, and session rotation.
- Mongo-backed opaque sessions with TTL.
- CSRF for browser cookie mutations.
- Google authorization-code login when enabled.
- Password reset if required by the migration policy.
- First-user bootstrap, household switching, invitations, membership, and roles.
- Protected SPA shell, sign-in, join, identity, and household settings.

API-key and public-share principals are completed in later phases but must fit the same
principal abstraction.

## Mandatory decisions before implementation

- [ ] Inspect real redacted `accounts` records and the exact Better Auth password algorithm,
      parameters, encoding, and version.
- [ ] Choose one password policy: direct verification, verified rehash-on-login, or mandatory
      reset. A bridge is allowed only if isolated, time-limited, monitored, and documented.
- [ ] Decide whether self-registration remains open.
- [ ] Define Google provider linking rules for matching email, existing password account,
      unverified email, and provider subject changes.
- [ ] Define username/email normalization and collision handling.
- [ ] Confirm intentional invalidation of all Durable Object sessions at cutover.
- [ ] Decide session idle/absolute lifetime and maximum concurrent sessions.

Record the outcome in an ADR and the compatibility matrix.

## Security architecture

Use a single request principal:

```text
userId
activeHouseholdId
authenticationKind = session | api-key | public-share | invitation-token
roles
scopes
sessionId, when applicable
```

Rules:

- Spring Security establishes identity; application services authorize business actions.
- Session cookies contain only a high-entropy opaque identifier.
- Store only a cryptographic hash of the session token in Mongo if the session repository
  design allows it.
- Rotate the session on login, privilege change, password change, and sensitive account-link
  events.
- Use Secure, HttpOnly, explicit SameSite, Path, and environment-correct Domain attributes.
- Browser mutations require CSRF; API keys do not use cookies and follow scope checks.
- Do not use email, username, or client-provided household ID as authorization proof.

## Workstream 1: session and Spring Security foundation

- [ ] Implement the Mongo session collection and TTL index separately from application ODM
      models.
- [ ] Implement atomic create/read/touch/rotate/revoke operations with bounded touch
      frequency.
- [ ] Configure Spring Security filter chains for SPA/session, OAuth callbacks, public/API,
      Actuator, and static resources.
- [ ] Configure CSRF token issuance and generated-client header handling.
- [ ] Add safe security headers, request limits, and explicit CORS denial for the same-origin
      production model.
- [ ] Implement authentication success/failure/logout handlers returning the standard JSON
      error model where relevant.
- [ ] Revoke server-side state on logout; clearing only the cookie is insufficient.
- [ ] Add authentication rate-limit ports and safe login audit events.

Avoid adding Spring Data Mongo as a second general mapping layer solely for sessions unless
its behavior is explicitly isolated and tested against the shared `MongoClient`.

## Workstream 2: credentials and OAuth

- [ ] Implement username-or-email lookup with enumeration-resistant error responses.
- [ ] Verify current password hashes according to the ADR and upgrade parameters on successful
      login when applicable.
- [ ] Implement registration with normalized unique fields and transaction-safe bootstrap.
- [ ] Implement password reset request/confirm if the migration or product policy requires it.
- [ ] Configure Google OAuth authorization code flow, state, nonce where applicable, exact
      redirect URI, and failure handling.
- [ ] Enforce explicit provider account-link rules; never auto-link from an untrusted email.
- [ ] Audit account link/unlink, reset, failed login, and suspicious replay without logging
      credentials or tokens.

Target façade:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
GET  /api/auth/oauth/google
GET  /api/auth/oauth/google/callback
POST /api/auth/password/reset/request
POST /api/auth/password/reset/confirm
```

## Workstream 3: households and membership

- [ ] Port user/profile/household/membership/invitation persistence documents.
- [ ] Implement first-user household bootstrap as an idempotent transaction.
- [ ] Implement active-household selection and validate membership on every session use.
- [ ] Implement household switching without accepting arbitrary non-member IDs.
- [ ] Implement invitation create, inspect/exchange, accept, expire, revoke, and replay rules.
- [ ] Implement owner/adult/viewer authorization policy in application services.
- [ ] Use transactions for invitation acceptance plus membership/default-household update.
- [ ] Add unique/idempotency constraints for duplicate membership and duplicate acceptance.
- [ ] Ensure all household repository queries include `householdId` or an equally restrictive
      owner criterion.

## Workstream 4: frontend

- [ ] Replace Better Auth's React client with the generated Tableplan auth client.
- [ ] Add one session-bootstrap request and protected-route behavior that avoids redirect
      flicker.
- [ ] Port sign-in, registration if enabled, auth error, household join, switcher, and identity
      settings.
- [ ] Add CSRF acquisition/refresh and one safe retry after session/CSRF rotation.
- [ ] Preserve the intended post-login return path while preventing open redirects.
- [ ] Handle intentional cutover logout with a clear sign-in state.
- [ ] Add accessible error summaries without exposing account existence.

## Testing

### Functional

- Register, login by username/email, session lookup, rotation, logout, and expiration.
- Google new-account, existing linked-account, rejected collision, cancelled, and provider
  error flows.
- Bootstrap, switch, invite, accept, revoke, expire, and role changes.
- Password compatibility against non-production hash fixtures.

### Security

- Session fixation and revoked/expired session rejection.
- Cookie attribute checks behind the production proxy topology.
- CSRF rejection for every cookie-authenticated mutation, including JSON and multipart.
- Login/reset rate limits and enumeration resistance.
- OAuth state/replay/redirect validation.
- Invitation token hashing, expiry, single use, and share-ID mismatch.
- Cross-user and cross-household access for every migrated repository operation.
- Log/trace/metric redaction for passwords, tokens, cookies, OAuth codes, and reset links.

### Concurrency

- Two simultaneous first-user bootstraps.
- Two accepts for one invitation.
- Membership revocation racing an authenticated request.
- Session rotation racing logout.
- Duplicate username/email registration.

## Migration preparation

- Build a read-only identity audit command that reports counts and incompatibilities without
  exposing hashes.
- Build a session-index migration and verification command.
- Produce user-communication text for forced re-login and password reset if needed.
- Do not import Durable Object sessions.
- Exercise the account policy on a copied preview dataset.

## Observability

- Login/register/OAuth outcomes by safe reason code.
- Active session count, creation, rotation, revocation, and expiration lag.
- CSRF and authorization denials by route family.
- Invitation issuance/acceptance/replay outcomes.
- No metric label may contain user ID, email, username, token, or cookie.

## Deliverables

- Auth/password/OAuth ADR.
- Spring Security and Mongo session implementation.
- Household application slice and protected SPA shell.
- Identity audit/migration report.
- Security and concurrency evidence.
- Runbook for key rotation, forced logout, compromised session, and OAuth outage.

## Risks and controls

| Risk | Control |
| --- | --- |
| Better Auth hashes are incompatible | Evidence-based reset or bounded rehash strategy |
| Auto-linking Google compromises accounts | Explicit verified provider-subject policy |
| Controller-only role checks are bypassed | Authorization in application services and scoped repository filters |
| Session touch overloads Mongo | Coalesced touch interval and TTL/index load test |
| Proxy config weakens secure cookies | Preview test through final TLS/proxy topology |

## Exit gate

Phase 03 is complete when migrated identities preserve user IDs, the chosen password path is
proven on preview fixtures, sessions rotate/revoke/expire correctly, CSRF and OAuth security
tests pass, and no tested user can read or mutate another user's or household's data.

## Handoff to Phase 04

Provide the unified principal, membership/role policy, session-aware generated client,
transaction conventions, audit events, and security test harness.


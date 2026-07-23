# Phase 04 — Preferences, Favourites, Saved Searches, and API Keys

## Objective

Port bounded authenticated mutations that exercise authorization, optimistic UI behavior,
idempotency, user preferences, and non-cookie authentication before the more complex planning
and ingestion phases.

## Scope

- Recipe favourites.
- Measurement and profile preferences.
- Configurable household meal slots.
- Saved recipe searches.
- Relevant settings and favourites SPA pages.
- API key create/list/revoke/authenticate/audit compatibility.

## Contract work

- [ ] Complete OpenAPI schemas for favourite state, profiles/preferences, meal slots, saved
      searches, and API key metadata.
- [ ] Define `PUT`/`DELETE` or idempotency semantics explicitly for favourite mutations.
- [ ] Define version/conflict behavior for editable preferences and meal slots.
- [ ] Define saved-search canonicalization, uniqueness, limits, and validation errors.
- [ ] Define API key creation response so raw secret material appears exactly once.
- [ ] Preserve verified current API key prefix, hashing, scope, expiry, and revoke semantics.

## Workstream 1: favourites

- [ ] Map existing `favourites` records without changing ID or relationship types.
- [ ] Implement list/check/add/remove through an application service.
- [ ] Enforce recipe visibility and active household/owner context before favouriting.
- [ ] Add unique constraints or conflict-safe upsert so repeated adds are idempotent.
- [ ] Decide and test behavior when a recipe becomes invisible or is deleted.
- [ ] Integrate favourite state into search/detail without N+1 queries.

## Workstream 2: user and household preferences

- [ ] Port user profile and measurement-system behavior.
- [ ] Validate IANA timezone and preserve existing timezone strings.
- [ ] Port configurable meal slots with stable IDs/order and protected default behavior.
- [ ] Define concurrency handling through version fields, compare-and-set, or a documented
      last-write policy.
- [ ] Ensure role policy distinguishes personal preferences from household configuration.
- [ ] Emit safe audit events for privileged household-setting changes.

## Workstream 3: saved searches

- [ ] Port normalization and validation using shared fixtures.
- [ ] Store the canonical form while preserving current display labels where required.
- [ ] Enforce per-user/household limits and unique naming rules.
- [ ] Reject filters that the current search contract no longer understands.
- [ ] Ensure saved searches cannot smuggle unauthorized owner/household filters.
- [ ] Implement list/create/update/delete with deterministic ordering.

## Workstream 4: API keys

- [ ] Inspect and prove the current prefix/hash format with non-secret fixtures.
- [ ] Implement cryptographically secure raw key generation and one-time display.
- [ ] Persist only prefix, hash, scopes, owner/household, timestamps, expiry, and safe
      metadata.
- [ ] Resolve API-key principals through a constant-time verification path.
- [ ] Enforce endpoint scopes in application services, not only MVC annotations.
- [ ] Implement create plus audit event atomically, and revoke/list/event inspection.
- [ ] Apply rate limits and `lastUsedAt` coalescing to avoid a write on every request.
- [ ] Preserve existing keys only if the exact verification format is proven.

## Workstream 5: frontend

- [ ] Port favourites listing and favourite controls on recipe cards/detail.
- [ ] Implement optimistic changes with rollback and cross-view cache consistency.
- [ ] Port profile, measurement, timezone, meal-slot, saved-search, and API-key settings.
- [ ] Display a raw API key once with explicit copy/acknowledgment behavior.
- [ ] Never persist raw keys in browser storage, logs, analytics, or error reports.
- [ ] Add empty, limit, validation, conflict, revoked, and expired states.

## Testing

- Repository tests for unique favourite/upsert, stable ordering, preference versions, and key
  lookup.
- Contract tests for all mutation status codes and error envelopes.
- Shared fixtures for search normalization and measurement preferences.
- Security tests for household role restrictions, invisible recipes, scope denial, revoked/
  expired keys, and cross-household key use.
- Concurrency tests for duplicate favourite adds, simultaneous saved-search naming, and
  preference updates.
- Browser tests for optimistic rollback, settings persistence, key one-time display, and
  session/API-key parity on allowed endpoints.
- Redaction tests seeded with raw key-like values.

## Observability

- Favourite mutation conflicts/failures.
- Preference and household-setting conflict rates.
- Saved-search validation/limit outcomes.
- API key authentication outcomes by safe reason, scope denial counts, and coalesced last-use
  update failures.

## Deliverables

- Favourites, preferences, meal-slot, saved-search, and API-key backend slices.
- Corresponding SPA pages/components.
- API-key compatibility report.
- Updated OpenAPI and generated client.
- Authorization, concurrency, and redaction evidence.

## Risks and controls

| Risk | Control |
| --- | --- |
| Existing keys become unusable | Prove the exact hash input/encoding before promising preservation |
| Optimistic favourite state diverges | Server idempotency plus invalidation/rollback tests |
| Saved query bypasses visibility | Canonical allowlist; derive household context server-side |
| Settings overwrite concurrent changes | Version/CAS contract or explicitly accepted last-write behavior |
| Raw key leaks after creation | One-response-only DTO, redaction tests, no client persistence |

## Exit gate

Phase 04 is complete when favourites and settings match accepted UI/API behavior, mutations
are idempotent or explicitly conflict-safe, household role restrictions pass, saved searches
cannot escape visibility rules, and new plus preserved-compatible API keys authenticate with
correct scope/revocation behavior.

## Handoff to Phase 05

Provide stable measurement/timezone/meal-slot rules, API-key principals, mutation conventions,
optimistic frontend patterns, and compare-and-set utilities.


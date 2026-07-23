# Phase 00 — Contract and Evidence Baseline

## Objective

Create a redacted, reproducible baseline that defines exactly what the Spring Boot port must
preserve. No production implementation should depend on memory or visual intuition for
parity.

## Inputs

- Current TypeScript/Cloudflare application at a known Git commit.
- Local or preview MongoDB with representative data.
- Access to current API, browser flows, indexes, validators, and Atlas Search configuration.
- [Architecture research](../architecture-research.md).

## Outputs

- Canonical OpenAPI starting contract.
- Redacted Mongo document fixtures and schema inventory.
- API response and error fixtures.
- Shared domain golden fixtures.
- Browser screenshots and critical-flow recordings/checklists.
- Compatibility matrix and unresolved decision register.
- Baseline capture scripts with instructions and no embedded secrets.

## Workstream 1: freeze source and scope

- [ ] Record the current application Git commit, deployed version, runtime configuration
      names, and Mongo database names.
- [ ] Inventory all frontend page routes, `/api/v1`, `/api/public`, `/api/auth`, `/mcp`,
      PDF, and download endpoints.
- [ ] Inventory all 64 `StorageClient` operations and map each to a functional area and
      destination phase.
- [ ] Classify features as active, operator-only, obsolete, or intentionally deferred.
- [ ] Record local, preview, and production topology without copying secret values.
- [ ] Confirm whether production users/data exist and the acceptable cutover downtime.

The output is `contracts/baseline/source-manifest.yaml`, reviewed by product and engineering.

## Workstream 2: API contract capture

- [ ] Export the current OpenAPI document.
- [ ] Expand reusable request, response, pagination, and error component schemas where the
      current document is incomplete.
- [ ] Capture successful and failing examples for every endpoint family.
- [ ] Record status codes, headers, cookie behavior, cache behavior, null/missing fields,
      ordering, pagination, and privacy-preserving `404` behavior.
- [ ] Normalize volatile values in fixtures: IDs, timestamps, request IDs, signed URLs, and
      generated tokens.
- [ ] Establish one canonical error envelope:

```json
{
  "code": "plan_item_not_found",
  "message": "The meal-plan item was not found.",
  "requestId": "00000000-0000-0000-0000-000000000000",
  "fieldErrors": {}
}
```

- [ ] Check in the initial `contracts/openapi.yaml` and a contract-diff command.

## Workstream 3: Mongo evidence

- [ ] Export redacted representative documents for all 28 managed collections.
- [ ] Include edge cases: missing versus null fields, empty embedded arrays/maps, all role
      types, expired records, legacy documents, and every recipe visibility mode.
- [ ] Capture collection validators including validation level and action.
- [ ] Capture every named index with key order, direction, uniqueness, sparsity, TTL,
      partial filters, and collation.
- [ ] Capture the complete `recipes_v1` Atlas Search definition and current status.
- [ ] Capture approximate collection sizes and cardinalities for load-test data shaping.
- [ ] Add automated scanning that rejects fixtures containing passwords, raw tokens, API
      secrets, cookies, private object-store URLs, or real personal data.

Fixtures must preserve BSON type information; Extended JSON is preferred over plain JSON
where dates, decimal values, or binary types are relevant.

## Workstream 4: domain golden fixtures

- [ ] Quantity parsing: integers, decimals, vulgar/common fractions, ranges, malformed input.
- [ ] Units: aliases, compatible/incompatible conversions, system preference, formatting.
- [ ] Recipe search: normalization, filtering, sort order, facets, and pagination.
- [ ] Meal-plan week and timezone boundaries, configurable slots, serving changes, copying.
- [ ] Shopping aggregation, checked-state retention, exclusions, and rounding.
- [ ] Saved-search validation and canonicalization.
- [ ] Recipe draft normalization and deterministic extraction.
- [ ] Token normalization, hashing inputs, expiration, and replay behavior.

Each fixture has an input, expected output/error, provenance, and a stable case identifier.
The same fixture files will run in Vitest and Kotlin tests.

## Workstream 5: UI and operational evidence

- [ ] Capture desktop and narrow-screen screenshots for every current page and important
      loading, empty, error, and permission state.
- [ ] Record critical browser flows: login, household join/switch, recipe search/detail,
      plan, shopping, ingestion, share, and settings.
- [ ] Record current PDF examples for A4/Letter and portrait/landscape.
- [ ] Record importer, facet refresh, index sync, migration, backup, restore, and deployment
      commands.
- [ ] Capture current baseline latency/error metrics if available, clearly identifying
      environment and dataset.

## Compatibility matrix

Create `contracts/baseline/compatibility-matrix.md` with one row per capability:

| Capability | Current contract | Port policy | Evidence | Destination phase |
| --- | --- | --- | --- | --- |
| User ID | String UUID | Preserve | Mongo fixture | 03 |
| Active session | Durable Object | Invalidate at cutover | Runtime inventory | 03/09 |
| API key hash | Existing format | Preserve if verified | Redacted fixture/test | 04 |

Every known incompatibility must state user impact, migration action, rollback impact, and
owner.

## Validation

- Baseline capture is repeatable against local/preview without manual editing.
- Contract fixtures parse and validate in CI.
- Redaction tests intentionally fail on seeded secret patterns.
- At least one representative fixture exists for every collection and endpoint family.
- Product or a designated domain owner approves critical UI/domain examples.

## Risks and controls

| Risk | Control |
| --- | --- |
| Fixtures leak production data | Prefer generated/local data; mandatory redaction scan and review |
| Baseline captures existing bugs as requirements | Label each behavior `preserve`, `fix`, or `defer` |
| Volatile fields make diffs noisy | Canonical normalization with explicit ignored paths |
| Hidden operator workflow is missed | Interview/runbook review plus source entry-point inventory |

## Exit gate

Phase 00 is complete when the team can run one command to validate the OpenAPI and fixtures,
the schema/search/index inventory is checked in and redacted, all active capabilities are
assigned to a later phase, and known compatibility breaks have owners.

## Handoff to Phase 01

Provide:

- Source manifest and compatibility matrix.
- Initial OpenAPI contract.
- Mongo schema/index/search manifest.
- ODM qualification fixtures.
- Domain golden fixture harness format.
- Confirmed local replica-set requirements.


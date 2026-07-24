# Local Verification Report — 2026-07-23

Environment: Java 21.0.2, Spring Boot 4.1.0, Kotlin 2.4.10, Gradle 9.0, Node 22,
MongoDB 8 replica-set primary, `application_local`.

## Automated build

```text
./gradlew check :backend:bootJar
BUILD SUCCESSFUL
ODM tests: passed
Backend tests: passed
Frontend TypeScript/Vite build: passed
Frontend Vitest: 8 passed
```

The checked-in OpenAPI parse/uniqueness test, quantity/range/unit conversion suite, migration
manifest tests, PDF test, importer test, planning/search normalization tests, request-ID test,
ODM suite, and frontend route/component/API tests all passed. `npm audit` reported zero
vulnerabilities.

The executable artifact is `backend/build/libs/tableplan.jar`; its final local SHA-256 is
`37e4c30748eab523990b00b1fd19c09cf10e82bc1c7e14a2c388d3ac23189266`.

The performance-budget gate passed at 77,406 gzip bytes for the entry JavaScript, 103,623
gzip bytes across all JavaScript, 367,826 bytes for all static frontend files, zero source
maps, and an exact 17-file match between `frontend/dist/assets` and the packaged JAR.

## Schema and import

- Initial `migrate --dry-run` reported all additive collection/index actions.
- `migrate` created 28 compatibility collections plus `sessions`, `jobs`, and
  `schema_migrations`, with exact named indexes and moderate/error validators.
- A second `migrate --dry-run` reported no Mongo action. Atlas Search remained a separate,
  explicit administration note.
- The migration ledger now refuses a changed checksum for an already-applied migration.
- `import-catalog --dry-run` read the three-row compatibility fixture: two accepted, one
  duplicate rejected.
- The applied two-row batch import produced 2 recipes, 24 units, 3 tag facets, 3 safe issue
  records, and a completed row-3 checkpoint with 2 imported/1 rejected.
- A fresh `application_ci_local` database repeated schema apply/no-op, validated and applied
  the checked-in two-row CI fixture, then refreshed four tag facets. CI performs the same
  operator sequence against a real MongoDB replica set.

## Live packaged-server checks

The JAR was started only with `java -jar ... serve` plus local configuration.

- `/health/live` and `/health/ready`: `UP`.
- `/api/v1/system/version` reported the packaged Spring runtime.
- Anonymous catalog list and recipe detail returned the imported fixture with parsed units.
- SPA fallback and hashed Vite assets were served from the JAR; hashed assets returned
  `public, max-age=31536000, immutable`.
- The isolated frontend owns all 15 captured source page routes, including authenticated,
  invitation, ingestion, planning, shopping, settings, and public-share flows.
- The served OpenAPI JSON parsed as 3.1.0 with 53 paths and 64 unique operation IDs.
- All 15 source page URLs returned the packaged SPA on direct navigation. The canonical
  `/sign-in` and `/auth/error` routes were explicitly checked through Spring Security.
- Security responses used the standard JSON envelope and included CSP, no-referrer,
  no-sniff, and request-ID headers.
- CSRF token acquisition plus BCrypt registration created an opaque Mongo session.
- That session remained valid across server restarts.
- A household invitation was created, safely inspected, accepted by a matching second
  account, and switched into; the invited role was `viewer` and the household showed two
  members.
- A `recipes:read` API key received `200` from recipe search and `403` from meal plans.
- A meal-plan item was created and retrieved with aggregate version 1.
- Its item-context endpoint returned the containing week and planned servings used by the
  recipe-detail SPA.
- Shopping generation produced two deterministic items.
- Shopping share exchange set a share-bound HttpOnly cookie; the public list exposed zero
  recipe-source records.
- PDF export returned a PDF 1.6 file beginning with `%PDF-`.
- A queued ingestion survived restart, was claimed by the bounded worker, became
  `review_ready`, and transactionally published a household recipe with two ingredients and
  two steps.
- A second reviewed ingestion returned canonical ingredient candidates, published the
  selected mapping with parsed quantities/units, and persisted a household alias.
- `jobs-status` returned state counts and queue age without exposing payloads.
- A shopping email moved queued → sent in one attempt through the safe capture adapter.
  Its encrypted raw share token was removed after acknowledgement, and logs contained only a
  provider message ID/template name.
- MCP initialized at protocol `2025-11-25`, listed all 17 frozen tools deterministically,
  and `search_recipes` returned two recipes as structured content.
- Cursor pagination traversed the catalog without offset scans and retained an exact
  cumulative total on the final page.
- The favorite-state endpoint returned a scalar state without downloading the favorite
  collection, and favorite listing used a batch recipe projection.
- The shopping overview returned the latest list, preferences, and shares in one request.
  Item toggles returned only the changed item, version, and timestamp and were restored
  after the smoke check.
- The four new plan-item, shopping-item, share-recency, and invitation-recency indexes
  applied successfully; the following migration dry run was a no-op.
- Prometheus exposed histogram samples for `tableplan.operation.duration`, and a Spring Boot
  layered extraction launched successfully through `JarLauncher`.

## Not executed

No production or preview system was read or changed. Atlas Search administration, real
Better Auth password samples, Google OAuth, S3, OpenRouter, Cloudflare email delivery, backup/restore rehearsal,
load/soak tests, container/SBOM scanning, deployment, traffic shifting, observation, and old
runtime retirement require external configuration and authorization.

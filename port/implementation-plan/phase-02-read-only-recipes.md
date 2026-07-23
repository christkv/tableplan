# Phase 02 — Read-Only Recipe Vertical Slice

## Objective

Port recipe search, facets, listing, and detail end to end. This phase proves the production
layering, Atlas Search behavior, API contract, SPA data flow, and parity process before
authentication-heavy mutations begin.

## Scope

Included:

- Public/catalog recipe visibility needed before login.
- Auth-aware filtering through a temporary test principal where necessary.
- Search normalization, filters, sort, facets, pagination, and recipe detail.
- `/recipes` and `/recipes/:recipeId`.
- Ingredient, unit, tag, collection metadata required by those pages.

Deferred:

- Login/session implementation.
- Favourites and saved searches.
- Private recipe create/edit/import.
- Meal planning and shopping mutations.

## API contract

Define or complete:

```text
GET /api/v1/recipes/search
GET /api/v1/recipes/{recipeId}
GET /api/v1/recipes/facets
GET /api/v1/recipe-metadata
```

Preserve current paths if the baseline uses a different exact split. Contract changes require
a compatibility-matrix entry before coding.

The contract must specify:

- Query normalization and maximum lengths/counts.
- Page/cursor semantics and stable tie-breaking.
- Allowed filters and sort options.
- Facet shape and zero/absent behavior.
- Visibility-dependent `404` behavior.
- Stable DTOs separate from persistence documents.
- Cache policy and dependency-unavailable errors.

## Workstream 1: domain and application model

- [ ] Port recipe IDs, visibility, source/type, ingredient, step, unit, tag, and summary value
      types.
- [ ] Port search input canonicalization from TypeScript.
- [ ] Run shared search and recipe-normalization fixtures in Kotlin.
- [ ] Define `SearchRecipes` and `GetRecipe` use cases with repository ports.
- [ ] Centralize access context so later session/API-key principals can replace the test
      principal without changing queries.
- [ ] Ensure domain/application modules have no Mongo/Atlas/Jackson annotations.

## Workstream 2: persistence and Atlas Search

- [ ] Map existing `recipes`, `ingredients`, `ingredient_aliases`, `units`, `tags`,
      `collections`, and `collection_recipes` documents.
- [ ] Use the native driver for Atlas Search pipelines, projections, aggregation, and stable
      pagination.
- [ ] Include household/owner/visibility predicates in the repository query itself.
- [ ] Centralize persisted field constants to reduce raw string errors.
- [ ] Preserve missing/null handling, date strings, numeric types, and embedded ordering.
- [ ] Verify `recipes_v1` definition/status during readiness or an explicit operational
      check without attempting destructive repair.
- [ ] Add explain-plan or query-shape assertions for representative search cases.

## Workstream 3: MVC API

- [ ] Implement validated request DTOs and response DTOs.
- [ ] Map invalid filters/query syntax to deterministic `400` codes.
- [ ] Map invisible and nonexistent recipes according to the privacy baseline.
- [ ] Apply request timeout and result-size limits.
- [ ] Generate or serve `/api/v1/openapi.json` from the checked-in contract.
- [ ] Add conditional caching only if it preserves visibility and current semantics; never
      put private responses in a shared cache.

## Workstream 4: React/Vite pages

- [ ] Move reusable JSX, CSS, and components for recipe listing/detail.
- [ ] Replace server loader imports with the generated API client.
- [ ] Implement URL-owned search/filter/sort state so refresh and deep links work.
- [ ] Preserve loading, empty, partial, error, responsive, and keyboard states.
- [ ] Preserve scroll/pagination behavior and prevent stale result races.
- [ ] Add direct-navigation and browser-back/forward tests.
- [ ] Ensure the SPA never needs access to Mongo-specific fields.

## Parity method

For every accepted search fixture:

1. Seed the same captured dataset into isolated old/new test databases.
2. Send a normalized request to both implementations.
3. Canonicalize only approved volatile fields.
4. Compare status, response schema, IDs, order, count, pagination, and facets.
5. Classify each difference as a port defect or approved contract correction.

Large dataset tests should cover common queries, rare filters, no results, broad results,
multi-filter combinations, malformed input, and Atlas Search unavailability.

## Testing

- Kotlin unit tests for normalization and DTO mapping.
- Repository integration tests with Atlas Search-capable preview tests plus a deterministic
  local fallback strategy for tests that cannot host Atlas Search.
- API contract and error tests.
- Cross-runtime parity fixtures.
- Authorization-query tests for public, household, owner-private, and unauthenticated views.
- Frontend component/accessibility tests.
- Browser tests for listing, filters, paging, detail, direct navigation, and missing recipes.
- Load tests for representative search/detail at planned Mongo pool limits.

## Observability

Add metrics/traces for:

- Search request duration and result count.
- Atlas Search dependency errors/timeouts.
- Repository time and Mongo pool wait.
- Normalized filter count and page size, without search text or private content.
- Client route errors and API request correlation ID in support diagnostics.

## Deliverables

- Read-only recipe domain/application/repository slice.
- Complete recipe-search/detail OpenAPI schemas and generated frontend client.
- Recipe listing/detail SPA pages.
- Search parity report with accepted deviations.
- Load/query-shape report and preview demonstration.

## Risks and controls

| Risk | Control |
| --- | --- |
| Atlas Search cannot run in local container | Keep repository contract tests local and run Atlas integration in preview |
| Access filter is applied after fetching | Require household/owner visibility in Mongo query tests |
| Old and new sort ties differ | Add explicit stable tie-break key |
| Generated client leaks persistence shape | Contract DTO review and serialization snapshot tests |
| SPA query races show stale results | Abort/cancel or request-key guards plus browser tests |

## Exit gate

Phase 02 is complete when catalog count, visibility, search normalization, ordering,
pagination, facets, and recipe details match the accepted baseline; preview load behavior is
within the agreed envelope; and the packaged JAR serves both recipe SPA routes directly.

## Handoff to Phase 03

Provide the access-context abstraction, recipe visibility policy, generated client workflow,
preview deployment path, and end-to-end parity harness.


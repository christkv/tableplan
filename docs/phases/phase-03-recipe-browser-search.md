# Phase 3: Recipe Browser, Search, and Favorites

## Objective

Deliver the first useful product loop: users can find recipes, inspect source and normalized data, adjust display servings, and save favorites. Search works locally using D1 FTS and relational filters.

## Dependencies

- Phase 1 authentication and household context.
- Phase 2 sample catalog and FTS staging output.

## Deliverables

- Recipe search page with query, pagination, ingredient filters, tag filters, and sort options.
- Recipe detail page with description, ingredients, steps, tags, servings, and parse-quality status.
- Original and parsed ingredient representations without exposing internal debugging noise by default.
- Favorite/unfavorite workflow and favorites page.
- Shared `RecipeSearchService` and recipe-detail service used by routes and later API/MCP adapters.
- Stable URL/query parameter contract for shareable searches.
- Empty, loading, partial-data, and error states.

## Search Contract

FTS indexes recipe name, description, normalized ingredients, tags, and selected instruction text. Relational filters handle:

- Included and excluded ingredient IDs.
- Tags and diet flags.
- Serving range and ingredient-count range.
- Parse-quality threshold.

Search results return stable recipe IDs, title, short description, default servings, ingredient preview, key tags, and quality flags. FTS ranking remains deterministic for the same database snapshot and query.

## User Experience

- Desktop uses a dense results surface with persistent filters where space allows.
- Mobile uses a compact search header and filter sheet.
- Recipe detail makes scaled parsed ingredients primary while retaining a clear way to view original lines.
- Favorites use an icon control with accessible labels and optimistic feedback that rolls back on failure.
- Missing or malformed steps render as partial data, not a broken page.

## Implementation Sequence

1. Implement repositories and domain DTOs for search, detail, and favorites.
2. Build FTS query composition and safe filter handling.
3. Add search results, facets, pagination, and URL state.
4. Build recipe detail and ingredient display modes.
5. Add favorite mutations and favorites view.
6. Add basic collections only if they do not delay the core favorite flow.
7. Instrument search latency, zero-result queries, and recipe-detail failures.

## Verification

- Unit tests for query normalization, filter composition, and result mapping.
- Integration tests against a known sample catalog with expected recipe IDs.
- Authorization tests for favorites.
- Browser tests for search-to-detail-to-favorite flow.
- Responsive checks on narrow mobile, tablet, and desktop widths.
- Accessibility checks for form labels, keyboard navigation, focus, and favorite controls.

## Acceptance Criteria

- Search works with no Vectorize or Workers AI binding.
- Users can combine text, ingredient, and tag filters and share the resulting URL.
- Tag discovery uses counted facets rather than a tag cloud. Facet counts are
  contextual to text and ingredient filters, multiple tags support explicit
  All/Any semantics, and household members can save named searches.
- Recipe detail remains usable for partially parsed source records.
- Favorites persist per user and cannot be modified by another user.
- UI and service-layer calls return the same stable recipe IDs for equivalent inputs.
- Common sample searches meet an agreed local latency budget.

## Non-Goals

- Semantic/vector ranking.
- Meal-plan mutation.
- Final US/metric conversion; Phase 4 owns conversion correctness.
- Public unauthenticated recipe access unless separately approved.

## Exit Artifact

An authenticated recipe catalog that is useful on its own and exposes stable services for planning, REST, and MCP surfaces.

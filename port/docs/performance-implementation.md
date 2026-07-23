# Performance Implementation

Last verified: 2026-07-23

The performance review has been implemented across the isolated Spring Boot port and its
React frontend.

## Database and API

- Recipe browse uses `(name, _id)` keyset cursors; Atlas Search uses sequence-token cursors.
  Cursor state includes the number of consumed rows so cumulative result totals remain
  correct without `skip`.
- The `recipes_v1` Search index maps `name` and the string `_id` as case-sensitive
  `token` fields, matching the stable `(score, name, _id)` Search sort tuple required by
  sequence-token pagination.
- Catalog, private-owner, and household browse indexes all end in `(name, _id)`, allowing
  MongoDB to merge the three visibility branches in index order without a collection scan
  or blocking sort.
- Search and favorite cards use Mongo projections. Favorite lists and shopping aggregation
  batch recipe IDs instead of issuing one query per recipe.
- Ingredient review, selection validation, and publication batch alias, ingredient, and
  selected-ID lookups.
- Meal-plan mutations return the updated aggregate from `findOneAndUpdate`. Shopping and
  public-share toggles return only the changed item and concurrency metadata.
- The shopping screen loads its list, preferences, and share records through one overview
  request.
- Named indexes cover meal-plan item IDs, shopping item IDs, recent list shares, and recent
  household invitations.
- Recipe facets have a bounded 15-second server cache. Fixed-name Micrometer histograms
  cover recipe search/facets, shopping aggregation, and ingestion review.

## Frontend

- Every page group is loaded with route-level `React.lazy` splitting.
- GET requests can share bounded in-flight/TTL cache entries; mutations invalidate them.
- Recipe facets load only while their panel is open. Plan and settings data loads in
  parallel, and the shopping overview removes its dependent request waterfall.
- Plan cells use a memoized date/slot index. Load-more merges cursor pages by recipe ID.
- Shopping toggles update optimistically and reconcile a small server delta.
- Ingestion and email polling back off and slow down while the document is hidden.

## Runtime and budgets

- Spring virtual threads are enabled by default.
- The Docker image consumes Spring Boot layers and starts with `JarLauncher`.
- Frontend resource copying is synchronizing, so removed content hashes cannot remain in
  the JAR. Production source maps are disabled.
- CI enforces 85,000 gzip bytes for entry JavaScript, 140,000 for all JavaScript, 1,000,000
  total frontend bytes, zero source maps, and exact packaged-asset parity.

The latest local results were 77,406 entry gzip bytes, 103,623 total JavaScript gzip bytes,
367,826 total static bytes, zero source maps, and 17 current packaged assets. Full
production-shaped load/soak testing remains an external cutover gate.

# Recipe Import Operations

## Safety Model

The importer reads `data/recipes_ingredients.csv` and writes generated artifacts under `.import/`. It never edits the source CSV. Sample imports are the default development path; a full import is a deliberate Phase 11 operation.

Every import records:

- Source file path, size, SHA-256 hash, and modification time.
- Importer/schema/parser versions.
- Started/completed timestamps and status.
- Source, accepted, rejected, inserted, and issue counts.
- Field parse coverage and unresolved-unit metrics.

## Development Sample

```bash
npm run import:sample
```

This selects a deterministic sample and focused malformed-data fixtures, writes a staging database, produces QA output, exports D1-compatible SQL, and applies it to local D1.

Override the sample size:

```bash
npm run import -- sample data/recipes_ingredients.csv --rows 10000 --out .import/sample.sqlite
```

## Import Pipeline

```bash
npm run import -- analyze data/recipes_ingredients.csv
npm run import -- sample data/recipes_ingredients.csv --rows 5000 --out .import/sample.sqlite
npm run import -- stage data/recipes_ingredients.csv --out .import/stage.sqlite
npm run import -- normalize .import/stage.sqlite
npm run import -- qa .import/stage.sqlite --out .import/reports/full
npm run import -- export-sql .import/stage.sqlite --out .import/sql
npm run import -- apply-local .import/sql
```

Remote application is intentionally separate:

```bash
npm run import -- apply-remote .import/sql --env preview --confirm
```

Do not apply to production until the Phase 11 preflight gates are recorded in the import report.

## QA Review

Review at minimum:

- Total source, accepted, rejected, and duplicate rows.
- Parse rates for ingredients, raw ingredients, steps, tags, and servings.
- Top unresolved units and ingredient phrases.
- Serving and instruction-count outliers.
- Foreign-key integrity and FTS coverage.
- Staging and exported database sizes relative to D1 limits.

An issue is not permission to discard a record. Unrecoverable structured fields remain represented through original text and `import_issues` rows.

## Idempotency and Recovery

- The source hash and importer version identify a run.
- Recipe upserts use stable source IDs.
- SQL chunks have stable ordering and checksums.
- Re-running the same sample must produce the same selected IDs and row counts.
- Duplicate source IDs are rejected and reported; they must never silently
  overwrite an accepted row in staging.
- Interrupted full staging runs resume from a recorded source position only when the source hash matches.
- Replacement requires an explicit destructive flag and a reviewed recovery plan.

## Production Checklist

1. Freeze schema migrations for the import window.
2. Run and review the full local import.
3. Confirm license/provenance and D1 capacity.
4. Apply the checksummed manifest to a clean preview database.
5. Run UI, API, MCP, FTS, and shopping-list smoke tests.
6. Export or snapshot recoverable production state.
7. Apply the reviewed manifest to production.
8. Populate embeddings asynchronously while FTS remains available.
9. Publish the final counts and exceptions in the progress/import report.

The corrected 5,000-row deterministic development sample contains 4,927 unique
recipes and 73 explicitly rejected duplicate source IDs from 500,471 rows seen.
Imported user-visible text is decoded for named, numeric, and bounded
double-encoded HTML entities before normalization and FTS indexing. Repeat SQL
application uses primary-key UPSERTs so existing favorites and plan references
are not deleted by catalog refreshes.

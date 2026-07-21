# Recipe Import Operations

This runbook covers the administrator-owned catalog CSV pipeline. It does not
cover user-private paste/file/image ingestion; see
`docs/operations/private-recipe-ingestion.md`. Catalog imports retain
`visibility=catalog` and `origin=dataset`.

## Safety Model

The importer reads `data/recipes_ingredients.csv` and writes generated artifacts under `.import/`. It never edits the source CSV. Sample imports are the default development path; a full import is a deliberate Phase 11 operation.

Every import records:

- Source file path, size, SHA-256 hash, and modification time.
- Importer/schema/parser versions.
- Started/completed timestamps and status.
- Source, accepted, rejected, inserted, and issue counts.
- Field parse coverage and unresolved-unit metrics.

## Full Catalog Import to Preview

Use this procedure to load the complete administrator-owned recipe catalog into
the remote `meal-planner-preview` D1 database. Run every command from the
repository root. Do not substitute `production` for `preview` while following
this guide.

### 1. Check capacity and prerequisites

The source CSV is approximately 783 MB. The current 5,000-row staging sample is
approximately 59 MB, so the complete staged database is expected to require
several gigabytes. Cloudflare D1 currently limits a database to 500 MB on
Workers Free and 10 GB on Workers Paid. A `wrangler d1 execute --file` import is
limited to 5 GB, and each SQL statement is limited to 100,000 bytes.

Confirm the Cloudflare account is on a plan with enough D1 capacity before
starting. See the official [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
and [import guidance](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

Confirm the source and available local disk space:

```bash
ls -lh data/recipes_ingredients.csv
df -h .
```

Allow at least 15 GB of free local space for the staging database, its WAL,
reports, and exported SQL. Do not use `.import/sql/sample/catalog.sql`; it is
only the deterministic development sample.

Verify the configured preview database before making changes:

```bash
npx wrangler d1 info DB --env preview
npx wrangler d1 migrations list DB --env preview --remote
```

The database must be named `meal-planner-preview`, and there must be no pending
migrations. If migrations are pending, apply them before importing:

```bash
npm run db:migrate:preview
```

Record the existing remote counts:

```bash
npx wrangler d1 execute DB \
  --env preview \
  --remote \
  --command "SELECT
    (SELECT COUNT(*) FROM recipes) AS recipes,
    (SELECT COUNT(*) FROM recipe_ingredients) AS recipe_ingredients,
    (SELECT COUNT(*) FROM recipe_steps) AS recipe_steps,
    (SELECT COUNT(*) FROM recipe_search_fts) AS fts_rows;"
```

### 2. Analyze the complete source

```bash
npm run import -- analyze data/recipes_ingredients.csv
```

This scans the full CSV without changing D1. Record the reported row and parser
failure counts with the import review.

### 3. Build a fresh full staging database

Use a new run-specific filename so a previous staging database cannot be
mistaken for the current import. The following examples use
`full-2026-07-21`; replace that label consistently for a later run.

```bash
npm run import -- stage \
  data/recipes_ingredients.csv \
  --out .import/full-2026-07-21.sqlite
```

Staging hashes and parses the complete source, normalizes data, writes stable
catalog identifiers, builds FTS content, and records rejected rows and repair
issues. Do not pass `--rows`; that option creates a bounded import rather than
the complete catalog.

The `normalize` command verifies the staged result and emits its normalization
report. Normalization itself already occurs during staging:

```bash
npm run import -- normalize .import/full-2026-07-21.sqlite
```

### 4. Generate and review QA

```bash
npm run import -- qa \
  .import/full-2026-07-21.sqlite \
  --out .import/reports/full-2026-07-21
```

Review `.import/reports/full-2026-07-21/qa-report.md` and its JSON companion:

```bash
sed -n '1,220p' .import/reports/full-2026-07-21/qa-report.md
```

Check foreign-key integrity. Success produces no output:

```bash
sqlite3 .import/full-2026-07-21.sqlite "PRAGMA foreign_key_check;"
```

Inspect the staging size:

```bash
ls -lh .import/full-2026-07-21.sqlite
```

Stop before export if foreign-key checking returns rows, the QA report is
missing, the import run is not marked `completed`, counts are implausible, or
the staged database cannot fit within the environment's D1 limit.

### 5. Export D1-compatible SQL

```bash
npm run import -- export-sql \
  .import/full-2026-07-21.sqlite \
  --out .import/sql/full-2026-07-21
```

Inspect the generated file:

```bash
ls -lh .import/sql/full-2026-07-21/catalog.sql
```

It must be smaller than 5 GB. Check the largest generated SQL statement:

```bash
LC_ALL=C awk 'BEGIN { RS=";" }
  { if (length($0) > max) max=length($0) }
  END { print "Largest SQL statement:", max, "bytes" }' \
  .import/sql/full-2026-07-21/catalog.sql
```

The reported maximum must be below `100000`. If either limit is exceeded, stop
and update the exporter to write smaller checksummed chunks before attempting a
remote import.

### 6. Apply the reviewed catalog to preview

This is the only step in this procedure that mutates the remote catalog. Read
the command carefully and confirm that it says `--env preview`:

```bash
npm run import -- apply-remote \
  .import/sql/full-2026-07-21 \
  --env preview \
  --confirm
```

The importer applies SQL files in sorted filename order through
`wrangler d1 execute DB --remote`. Catalog rows use stable primary-key upserts,
so retrying the same reviewed export is safe after a transient failure. Do not
generate a different export in the middle of a retry.

### 7. Verify the remote result

Run the count query again:

```bash
npx wrangler d1 execute DB \
  --env preview \
  --remote \
  --command "SELECT
    (SELECT COUNT(*) FROM recipes) AS recipes,
    (SELECT COUNT(*) FROM recipe_ingredients) AS recipe_ingredients,
    (SELECT COUNT(*) FROM recipe_steps) AS recipe_steps,
    (SELECT COUNT(*) FROM recipe_search_fts) AS fts_rows;"
```

The remote counts must match the reviewed QA report. Confirm that every recipe
has an FTS row:

```bash
npx wrangler d1 execute DB \
  --env preview \
  --remote \
  --command "SELECT COUNT(*) AS recipes_without_fts
    FROM recipes r
    WHERE NOT EXISTS (
      SELECT 1 FROM recipe_search_fts f WHERE f.recipe_id = r.id
    );"
```

`recipes_without_fts` must be `0`. Finally, use the preview application to
search for several known recipes, open their ingredient and instruction views,
add recipes to a meal plan, and generate a shopping list.

### 8. Failure and recovery

- If staging or QA fails, keep the failed artifacts for diagnosis and restart
  with a new run label.
- If the SQL upload fails before execution, correct the cause and retry the
  exact same reviewed export.
- If remote execution stops partway through, rerun the exact same export. The
  upserts and per-recipe FTS refresh make the import repeatable.
- If a completed import is incorrect, use D1 Time Travel or rebuild the isolated
  preview database from migrations and the last reviewed export.
- Keep the source hash, QA JSON, SQL filename and size, final remote counts, and
  smoke-test result in the release record.

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

# Phase 2: Import Tool MVP

## Objective

Build a repeatable, observable CLI pipeline that turns the source CSV into normalized relational data. It must support fast deterministic samples for development and preserve enough evidence to improve parsing without losing source fidelity.

## Dependencies

- Phase 1 schema and migrations.
- `data/recipes_ingredients.csv` available locally.

## Dataset Constraints

- Approximately 500,471 recipes and 793 MB of CSV data.
- List-like fields include malformed values, especially `steps` with embedded unescaped quotes.
- `ingredients_raw` is the source of truth for quantities and display text.
- Ingredient names have a large alias surface and cannot all be safely canonicalized in one pass.
- Serving values include valid large-batch recipes and invalid outliers.

## Deliverables

- Streaming import CLI that does not load the full CSV into memory.
- Staging SQLite database compatible with the production D1 schema.
- Strict parsers with field-specific tolerant fallbacks.
- Quantity, unit, ingredient, tag, and serving normalization passes.
- Import run records, issue quarantine, metrics, and human-readable QA reports.
- Deterministic sample and focused regression fixtures.
- Chunked SQL exporter and local/preview apply commands.
- Resume/idempotency strategy keyed by source hash, tool version, and source recipe ID.

## Command Contract

```bash
npm run import -- analyze data/recipes_ingredients.csv
npm run import -- sample data/recipes_ingredients.csv --rows 5000 --out .import/sample.sqlite
npm run import -- stage data/recipes_ingredients.csv --out .import/stage.sqlite
npm run import -- normalize .import/stage.sqlite
npm run import -- qa .import/stage.sqlite --out .import/reports
npm run import -- export-sql .import/stage.sqlite --out .import/sql
npm run import -- apply-local .import/sql
npm run import -- apply-remote .import/sql --env preview
```

Destructive replacement requires an explicit flag and is never the default.

## Pipeline Stages

1. Fingerprint the input file and create an `import_runs` record.
2. Stream and validate CSV rows while retaining source IDs and source field values.
3. Parse `ingredients`, `ingredients_raw`, `steps`, and `tags` using strict parsing first.
4. Apply conservative repair only where the result is unambiguous; quarantine all other failures.
5. Parse raw ingredient lines into quantity range, unit, ingredient phrase, preparation, and package size.
6. Canonicalize high-confidence ingredient aliases and retain unresolved or low-confidence phrases.
7. Normalize tags and serving values; attach quality flags instead of deleting outliers.
8. Populate recipe, step, ingredient, alias, relationship, and FTS staging tables.
9. Produce QA reports and SQL chunks with stable ordering.

## QA Metrics

- Input, accepted, quarantined, inserted, and updated row counts.
- Parse rates by field and parser path.
- Duplicate and missing source IDs.
- Ingredient-line coverage and confidence distribution.
- Most frequent unresolved units and ingredient phrases.
- Serving and step-count outliers.
- Foreign-key and FTS coverage checks.
- Database and SQL export sizes.

Each issue records source recipe ID, field, severity, reason code, parser version, and a bounded raw excerpt.

## Sample and Fixture Strategy

- Select samples deterministically from source ID hashes so every developer sees the same catalog.
- Include common family meals plus fixtures for malformed steps, ranges, fractions, package sizes, missing quantities, count units, and large servings.
- Keep a very small hand-reviewed test fixture in version control; do not commit generated sample databases.

## Verification

- Parser unit tests for every fixture class.
- Golden tests for normalized recipe and ingredient output.
- Import the same sample twice and verify idempotent row counts.
- Interrupt and resume a staging run without duplicate rows.
- Validate generated SQL against a fresh local D1 database.
- Compare source, staging, and exported counts in an automated smoke test.

## Acceptance Criteria

- A 5,000-row sample imports in a few minutes on a normal development machine.
- Peak memory remains bounded during CSV ingestion.
- QA output exposes parse coverage and the most important unresolved cases.
- No source recipe or ingredient line disappears silently.
- A sample export applies to local D1 and can power Phase 3 pages.
- Repeating an import with the same source and tool version is safe and reproducible.

## Non-Goals

- Perfect canonicalization of all 247,000-plus ingredient phrases.
- Full production import or Vectorize population.
- Nutrition enrichment.
- Admin web UI for import operations.

## Exit Artifact

A versioned import tool and a representative local recipe catalog suitable for UI, search, and quantity-engine development.

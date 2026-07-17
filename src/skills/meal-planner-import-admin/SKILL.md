---
name: meal-planner-import-admin
description: Run, diagnose, and review the Tableplan CSV recipe import pipeline, including deterministic sampling, local SQLite staging, parse QA, D1 SQL export, and guarded remote application. Use for catalog refreshes, importer failures, data-quality audits, or production import preparation.
---

# Tableplan Import Administration

Treat imports as an auditable data operation. Read
`references/import-operations.md` and the repository's
`docs/operations/recipe-import.md` before running a full or remote import.

## Development Workflow

1. Verify that `data/recipes_ingredients.csv` exists and do not modify it.
2. Run `npm run import:sample` for routine development.
3. Review the run summary and `.import/reports/` output.
4. Run `npm run check` after importer or schema changes.
5. Query local D1 counts and a known recipe before declaring the import usable.

## Full Import Workflow

1. Run `analyze` and record the source SHA-256 hash.
2. Run `stage` into a new local SQLite path.
3. Run `normalize` and `qa`; review rejected and duplicate source IDs,
   unresolved units, repaired lists, foreign keys, and FTS coverage.
4. Stop if the report does not reconcile source rows to accepted plus rejected
   rows.
5. Run `export-sql` and retain its checksummed manifest.
6. Apply to local D1, then a clean preview D1.
7. Exercise UI, REST, MCP, planning, and shopping-list smoke tests.
8. Apply remotely only after explicit environment confirmation and a reviewed
   recovery plan.

## Guardrails

- Never edit or replace the source CSV.
- Never apply to production as a side effect of staging or QA.
- Never use production credentials in commands recorded in documentation.
- Do not suppress rejected-row or duplicate-ID findings.
- Preserve raw source strings when normalized parsing is partial.
- Do not populate embeddings until relational and FTS checks pass.


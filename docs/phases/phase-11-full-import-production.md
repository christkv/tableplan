# Phase 11: Full Import and Production Launch

## Objective

Load the complete recipe catalog into preview and production through a reproducible, reviewed process, populate search indexes, and launch the working UI/API/MCP stack with recovery procedures.

## Dependencies

- Phase 2 import pipeline and quality reports.
- Stable schema and public contracts through Phase 7.
- Phase 10 embedding and hybrid-search pipeline.
- Confirmed dataset license, provenance, and attribution requirements.

## Deliverables

- Full local staging import from the fingerprinted source CSV.
- Reviewed QA report and explicit exception register.
- D1 capacity estimate from the real normalized and FTS database.
- Chunked, checksummed SQL export and import manifest.
- Preview and production relational imports.
- Preview and production Vectorize indexes.
- Smoke-test suite for UI, REST, MCP, FTS, hybrid search, planning, and list generation.
- Production runbook, recovery/forward-fix procedure, and launch report.

## Preflight Gates

- Dataset provenance and release rights are documented.
- Schema migrations are frozen for the import window.
- D1 database plus expected growth remains below the chosen operating threshold, not merely below the hard limit.
- Parse, quarantine, unresolved-unit, duplicate-ID, and FTS coverage thresholds are approved.
- Preview OAuth, API keys, MCP, queues, and Vectorize are healthy.
- Backup/export and forward-fix procedures have been rehearsed in preview.

## Import Sequence

1. Fingerprint source and record importer/parser/schema versions.
2. Run full local stage and normalization.
3. Produce QA, size, count, and exception reports.
4. Review thresholds and sign off the import manifest.
5. Export stable, checksummed D1 SQL chunks.
6. Apply to a clean preview database and run integrity checks.
7. Build preview FTS and embeddings; execute all smoke tests.
8. Schedule production window and confirm secrets/resource bindings.
9. Apply the reviewed manifest to production and verify counts after each stage.
10. Enqueue versioned embeddings, monitor completion, and enable hybrid search gradually.
11. Publish the launch/import report and preserve generated artifacts in controlled storage.

## Verification

- Source-to-staging-to-D1 count reconciliation by table.
- Foreign-key, duplicate, orphan, and FTS coverage checks.
- Representative and random recipe-detail comparisons against source rows.
- Search relevance and latency checks across common and adversarial queries.
- End-to-end household plan and shopping-list workflow against production.
- REST key and OAuth MCP smoke tests with dedicated test accounts.
- Recovery rehearsal in preview using the same manifest format.

## Acceptance Criteria

- Production can search and open the full imported catalog.
- Import results are reproducible from source hash and recorded tool versions.
- QA exceptions are visible and no source rows disappear without a recorded issue.
- UI, API, and MCP return consistent recipe IDs and quantities.
- Vector indexing progress is observable, retryable, and never blocks FTS search.
- A documented recovery or forward-fix path exists for every production import step.

## Non-Goals

- Resolving every low-confidence ingredient alias before launch.
- Importing additional external datasets.
- Nutrition enrichment.
- Zero-downtime replacement of arbitrary future schemas; later imports use the proven runbook and versioning model.

## Exit Artifact

A production deployment containing the complete reviewed recipe catalog and all supported product/integration surfaces.

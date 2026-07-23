# Implementation Status

Last updated: 2026-07-23

| Phase | Implementation | Verification | Remaining external gate |
| --- | --- | --- | --- |
| 00 — Contract and evidence baseline | Complete locally | Source commit, 43 source routes, 64 storage operations, 28 collections, and OpenAPI recorded | Redacted production samples, traffic baseline, and owner-approved downtime |
| 01 — Spring foundation and ODM | Complete locally | Gradle checks, ODM tests, packaged non-web operators, bootable JAR, Mongo schema apply/no-op | Preview artifact/image scan |
| 02 — Read-only recipes | Complete locally | Fixture import, catalog listing/detail/facets, and full recipe search/detail SPA routes | `recipes_v1` definition/status and text-search parity on Atlas |
| 03 — Authentication and households | Complete locally | CSRF, BCrypt registration, opaque session persistence, invitation acceptance, switching, role isolation | Real Better Auth hash evidence, production Google OAuth credentials/callback |
| 04 — Preferences, favourites, saved searches, API keys | Complete locally | APIs implemented; live API-key read scope allowed recipes and denied plans | Production key sample compatibility and rate-limit sizing |
| 05 — Planning and shopping | Complete locally | Live plan creation, deterministic shopping generation, tenant scoping, versioning, quantity/range parsing and metric/US conversion tests | Production-shaped concurrency/load suite |
| 06 — Private recipes and ingestion | Complete locally | Local artifact, S3 adapter, leased jobs, restart recovery, payload-free status/replay operators, review/publish transaction, OpenRouter adapter | S3/OpenRouter sandbox credentials and content-policy approval |
| 07 — Shares, email, PDF | Complete locally | Share exchange/cookie isolation, source redaction, encrypted delivery cleanup, valid PDFBox PDF | SMTP sandbox/domain, provider bounce policy, visual PDF golden approval |
| 08 — Integrations and operations | Complete locally | 64-operation OpenAPI, full isolated 15-page SPA, MCP 2025-11-25 with 17 tools, resumable importer, checksum-guarded no-op migration, performance budgets, layered JAR extraction, and runbooks | Atlas sync, restored-copy rehearsal, load/soak, container and SBOM scans |
| 09 — Cutover and retirement | Runbook complete; production execution not authorized | Cutover, rollback, observation, backup/restore, and incident procedures checked in | Production access, owners, backups, change window, traffic shift, observation period |

## Local evidence

See [verification-report-2026-07-23.md](verification-report-2026-07-23.md). The local
`application_local` database contains intentional smoke fixtures used by that report.

## Gate policy

“Complete locally” means the code path and local executable gate passed. It does not claim
that provider, production-data, load, preview, or production-cutover checks ran without the
credentials, environment, and authority those checks require.

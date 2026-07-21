# MongoDB-only storage migration plan

Status: repository implementation complete on 2026-07-21. External preview/production infrastructure and data import remain operator tasks.

## Target architecture

```text
Browser / API / MCP
        |
Cloudflare application Worker
        | HTTPS + service token
Bounded regional MongoDB gateway + Better Auth
        |
MongoDB replica set / Atlas
```

Database names are fixed: local `application_local`, preview `application_preview`, and production `application`.

## Completed code changes

- All application storage calls use the versioned `StorageClient` and `MongoGatewayStorageClient`.
- Authentication is always proxied to Better Auth on the gateway.
- The gateway implements recipe, household, plan, shopping, share, API-key, ingestion, email, and auth storage with bounded pools, deadlines, body/concurrency limits, validators, indexes, logs, health, and graceful shutdown.
- The raw CSV importer writes resumable, idempotent MongoDB bulk upserts with source hashes, checkpoints, issue quarantine, a four-connection cap, and a production confirmation gate.
- Worker configuration no longer has a database binding or backend selector.
- Setup, deployment, local-development, household, and import runbooks describe MongoDB only.

## Removed code

- D1 storage client, household/email adapters, health path, and shadow-read client.
- SQL repositories under `src/db` and the SQL recipe-ingestion service.
- Direct database functions in auth, API keys, invitations, shares, and email modules.
- SQL migrations and Wrangler database migration scripts.
- SQLite/SQL catalog staging/export/apply importer.
- One-shot legacy database converter and runtime rollback/maintenance switches.
- D1 bindings and generated `DB` environment type.

Pure validation and transformations were retained in `src/domain` and `src/import`.

## Data import plan

1. Provision a transaction-capable MongoDB deployment and separate admin, importer, and gateway credentials.
2. Run `npm run gateway:migrate -- --atlas-search` against `application_preview`.
3. Run the raw importer against `application_preview`; review `import_runs` and `import_issues` and smoke-test preview.
4. Repeat schema setup/import against `application`, using `--allow-production` only after backup/capacity/release approval.
5. Disable importer credentials outside import windows.

## External completion gates

- Gateway instance/pool budget fits the MongoDB connection limit with headroom.
- Backups and restore are tested.
- Atlas Search is ready.
- Full import counts/issues reconcile.
- Better Auth/Dash and all application smoke tests pass through each public origin.
- Monitoring covers gateway availability, latency, in-flight saturation, connection-pool pressure, MongoDB errors, and queue retries.

Remote legacy database resources, if any still exist in the Cloudflare account, are not referenced by this repository. Delete them separately only after verifying backups and the live deployment.

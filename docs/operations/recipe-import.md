# Recipe import operations

This runbook loads the administrator-owned raw CSV catalog into MongoDB. User paste/file/image ingestion is a separate application workflow.

## Guarantees

`npm run import` streams the CSV and:

- hashes the entire source and uses a stable run ID;
- parses and normalizes one row at a time;
- upserts stable recipe, ingredient, tag, and unit documents;
- rejects duplicate source IDs and oversized MongoDB documents into `import_issues`;
- checkpoints after each bulk batch and resumes the same source;
- refreshes materialized catalog tag counts before marking the run complete or paused;
- limits its MongoDB pool to four connections;
- refuses the `application` production database without `--allow-production`.

The importer connects with a dedicated maintenance credential. Normal application traffic still goes through the gateway.

## Local sample import

```bash
node --env-file=.env.gateway.local --import tsx \
  scripts/import-recipes-mongodb.ts \
  data/recipes_ingredients.csv \
  --database application_local \
  --limit 5000 \
  --batch-size 500
```

A limited run ends with status `paused`.

## Full local import

Run schema setup first, then run the importer without `--limit`:

```bash
npm run gateway:migrate:local
node --env-file=.env.gateway.local --import tsx \
  scripts/import-recipes-mongodb.ts \
  data/recipes_ingredients.csv \
  --database application_local \
  --batch-size 500
```

This imports every valid recipe from the CSV. If the sample import was already run, the full command resumes from that run's checkpoint. If the process is interrupted, repeat the exact command.

Verify the local result:

```bash
mongosh 'mongodb://127.0.0.1:27017/application_local?directConnection=true'
```

```javascript
db.recipes.countDocuments({ origin: "dataset", status: "active" })
db.import_runs.find().sort({ startedAt: -1 }).limit(1).pretty()
db.import_issues.countDocuments({ severity: "error" })
```

The latest run must have `status: "completed"`. Review error-level issues rather than assuming every raw row was accepted.

## Full preview import

1. Run schema/index setup first:

```bash
MONGODB_URI='<admin-uri>' \
MONGODB_DATABASE=application_preview \
MONGODB_GATEWAY_SERVICE_TOKEN='<service-token>' \
BETTER_AUTH_URL='https://family-meal-planner-preview.christkv.workers.dev' \
BETTER_AUTH_SECRET='<preview-secret>' \
npm run gateway:migrate -- --atlas-search
```

2. Import using the dedicated preview importer credential:

```bash
MONGODB_URI='<preview-import-uri>' \
npm run import -- data/recipes_ingredients.csv \
  --database application_preview \
  --batch-size 500
```

3. If interrupted, repeat the exact command. The source hash selects the same `import_runs` document and resumes at `checkpointRow`.

4. Review the run in `mongosh`:

```javascript
use application_preview
db.import_runs.find().sort({ startedAt: -1 }).limit(1)
db.import_issues.aggregate([{ $match: { importRunId: "<run-id>" } }, { $group: { _id: "$reasonCode", count: { $sum: 1 } } }, { $sort: { count: -1 } }])
db.recipes.countDocuments({ origin: "dataset", status: "active" })
db.recipes.countDocuments({ $or: [{ name: "" }, { steps: { $size: 0 } }] })
```

The run must be `completed`. Reconcile `rowsImported + rowsRejected` with `checkpointRow`, account for the CSV header, review every rejection class, and confirm representative searches through the preview application.

## Production import

Only use the exact production database name and explicit confirmation:

```bash
MONGODB_URI='<production-import-uri>' \
npm run import -- data/recipes_ingredients.csv \
  --database application \
  --batch-size 500 \
  --allow-production
```

Before running it, verify the URI, cluster, database, source SHA-256, backup status, available storage, Atlas Search readiness, and approved release record. Disable the importer credential afterward.

## Options

```text
--database <name>       Target database; defaults to MONGODB_DATABASE or application_local
--batch-size <1..1000>  Rows per checkpointed bulk batch; default 500
--limit <count>         Pause after this many newly imported recipes
--run-id <id>           Explicit run ID; normally let the source hash choose it
--allow-production      Required when database is application
```

## Recovery

- Parser or validation failure: the run becomes `failed`; fix the cause and rerun with the same source.
- Process/network interruption: repeat the command to resume from the last durable checkpoint.
- Changed source file: it produces a new source hash/run; review it as a separate catalog release.
- Incorrect completed catalog: restore the database backup or rerun the approved source after correcting the deterministic parser. Do not hand-edit large sets of catalog documents.

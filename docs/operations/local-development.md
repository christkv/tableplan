# Local development

## First run

Prerequisites: Node.js 22+, a local MongoDB instance listening on `127.0.0.1:27017`, and `data/recipes_ingredients.csv` for catalog work.

```bash
npm install
cp .dev.vars.example .dev.vars
cp gateway/local.env.example .env.gateway.local
npm run gateway:migrate:local
npm run import:sample
npm run gateway:dev
# In another terminal:
npm run dev
```

`npm run gateway:dev` runs the Node gateway. `npm run gateway:worker:dev` is an alternative that runs the same gateway runtime inside the Cloudflare Worker and Durable Object implementation on port `8790`; do not run both simultaneously.

The gateway-only `.env.gateway.local` contains `mongodb://127.0.0.1:27017/?directConnection=true`, selects `application_local`, and binds the gateway to `127.0.0.1:8790`. The Worker-facing `.dev.vars` contains only:

```text
MONGODB_GATEWAY_URL=http://127.0.0.1:8790
MONGODB_GATEWAY_SERVICE_TOKEN=local-gateway-token-change-me-1234567890
```

The same token is used by the local application and gateway. The local database is `application_local`; `npm run gateway:migrate:local` applies its idempotent schema/index definitions.

To make MongoDB's named indexes exactly match the definitions in `gateway/schema.ts`, preview the changes and then apply them:

```bash
npm run gateway:indexes:sync:local -- --dry-run
npm run gateway:indexes:sync:local
```

The synchronizer creates missing indexes, rebuilds changed definitions, renames equivalent indexes to their declared names, and drops obsolete named indexes. It never drops `_id_`.

Vite normally uses `http://127.0.0.1:5173` and selects another port if it is occupied. Local Better Auth trusts loopback origins on any port.

## Logging

`LOG_LEVEL` accepts `DEBUG`, `INFO`, or `ERROR` and defaults to `INFO` in every environment. Configure the application Worker in `.dev.vars` and the MongoDB gateway in `.env.gateway.local`; restart the corresponding process after changing either file.

At `INFO`, the gateway prints lifecycle messages without MongoDB query payloads. `DEBUG` additionally prints operation and MongoDB command events with the database, collection, request/connection identifiers, actual query payload, duration, and outcome. Aggregation pipelines and their nested stages are rendered in full instead of being collapsed to `[Object]` by Node's console. Password, token, secret, authorization, cookie, credential, and API-key fields are recursively replaced with `[REDACTED]`; MongoDB authentication commands and command replies are never logged. `ERROR` prints failures only.

For a one-off verbose gateway session without editing the file:

```bash
LOG_LEVEL=DEBUG npm run gateway:dev
```

Example MongoDB log entry:

```text
[tableplan] DEBUG mongodb command.succeeded { command: 'find', database: 'application_local', collection: 'recipes', requestId: 42, connectionId: 7, query: { find: 'recipes', filter: { status: 'active' }, limit: 24 }, durationMs: 3.21 }
```

## Import the complete recipe catalog

`npm run import:sample` is intended for quick UI work and pauses after 5,000 imported recipes. Import every recipe from the raw CSV with:

```bash
npm run gateway:migrate:local
node --env-file=.env.gateway.local --import tsx \
  scripts/import-recipes-mongodb.ts \
  data/recipes_ingredients.csv \
  --database application_local \
  --batch-size 500
```

Do not add `--limit` to the full import. The importer derives a stable run ID from the source file hash. If the sample was already imported, or the full import is interrupted, repeat the same full command and it resumes after the last durable checkpoint. The gateway and application may remain running during the import.

Verify completion with:

```bash
mongosh 'mongodb://127.0.0.1:27017/application_local?directConnection=true'
```

```javascript
db.recipes.countDocuments({ origin: "dataset", status: "active" })
db.import_runs.find().sort({ startedAt: -1 }).limit(1).pretty()
db.import_issues.countDocuments({ severity: "error" })
```

The latest import run must report `status: "completed"`. Review any error-level records in `import_issues` before treating the catalog as ready.

## Useful commands

```bash
npm run gateway:migrate:local
npm run gateway:indexes:sync:local -- --dry-run
npm run gateway:indexes:sync:local
npm run import:sample
# Full catalog: use the command in "Import the complete recipe catalog" above.
npm test
npm run typecheck
npm run build
npm run check
```

Inspect MongoDB with:

```bash
mongosh 'mongodb://127.0.0.1:27017/application_local?directConnection=true'
```

Example checks:

```javascript
db.recipes.countDocuments({ status: "active" })
db.import_runs.find().sort({ startedAt: -1 }).limit(3)
db.import_issues.aggregate([{ $group: { _id: "$reasonCode", count: { $sum: 1 } } }, { $sort: { count: -1 } }])
```

## Local test account

With the app running:

```bash
npm run seed:test-user
```

Use username `tableplanlocal`, email `local-test@tableplan.test`, and password `Tableplan-local-2026!`. These credentials are local-only.

## Local feature behavior

- Recipe text extraction is deterministic unless `RECIPE_EXTRACTION_PROVIDER=openrouter` is configured.
- R2 uses the local emulator.
- `PDF_MODE=html-preview` renders printable HTML.
- `EMAIL_MODE=capture` records delivery without sending external email.
- MongoDB is always reached through the gateway by application requests.

## Troubleshooting

- Gateway unavailable: check `curl http://127.0.0.1:8790/readyz`, the token match, and `MONGODB_GATEWAY_URL`.
- Empty recipes: run the Mongo importer and inspect `application_local.import_runs`.
- Recipe facet requests time out after an older import: run `npm run recipes:facets:local` once to materialize tag counts. Current imports refresh them automatically.
- Catalog tag searches remain slow after upgrading: run `npm run gateway:migrate:local` to create the `recipe_catalog_tags_list` compound multikey index.
- Missing collection/index: run `npm run gateway:migrate:local`.
- Wrong app detected on port 5173: use the exact URL printed by Vite and set `LOCAL_APP_URL` for `seed:test-user`.
- Changed Cloudflare bindings: run `npm run cf-typegen`.

Stop `npm run gateway:dev` and `npm run dev` with Ctrl-C. The existing MongoDB service owns and retains `application_local`.

# Local development

## First run

Prerequisites: Node.js 22+, a transaction-capable local MongoDB instance listening on `127.0.0.1:27017`, and `data/recipes_ingredients.csv` for catalog work.

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

The gateway-only `.env.gateway.local` contains `mongodb://127.0.0.1:27017/?directConnection=true`, selects `application_local`, and binds the gateway to `127.0.0.1:8790`. The Worker-facing `.dev.vars` contains only:

```text
MONGODB_GATEWAY_URL=http://127.0.0.1:8790
MONGODB_GATEWAY_SERVICE_TOKEN=local-gateway-token-change-me-1234567890
```

The same token is used by the local application and gateway. The local database is `application_local`; `npm run gateway:migrate:local` applies its idempotent schema/index definitions.

Vite normally uses `http://127.0.0.1:5173` and selects another port if it is occupied. Local Better Auth trusts loopback origins on any port.

## Useful commands

```bash
npm run gateway:migrate:local
npm run import:sample
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
- Missing collection/index: run `npm run gateway:migrate:local`.
- Wrong app detected on port 5173: use the exact URL printed by Vite and set `LOCAL_APP_URL` for `seed:test-user`.
- Changed Cloudflare bindings: run `npm run cf-typegen`.

Stop `npm run gateway:dev` and `npm run dev` with Ctrl-C. The existing MongoDB service owns and retains `application_local`.

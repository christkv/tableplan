# Tableplan

Tableplan is a family meal planner built with React Router and Cloudflare Workers. MongoDB is its only database. The Cloudflare application Worker reaches MongoDB through the separately deployed, bounded Node gateway in `gateway/`; it never opens database connections itself.

The catalog importer streams `data/recipes_ingredients.csv` directly into MongoDB with stable IDs, resumable checkpoints, duplicate-safe upserts, issue records, and a maximum four-connection pool.

## Quick start

Prerequisites: Node.js 22+, a transaction-capable local MongoDB instance on port `27017`, and the source CSV in `data/`.

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

Local data is isolated in `application_local`. The gateway listens at `http://127.0.0.1:8790`; application requests never connect to MongoDB directly. Run the full quality gate with `npm run check`.

## Documentation

- [Initial setup](INITIAL_SETUP.md)
- [Local development](docs/operations/local-development.md)
- [Recipe import](docs/operations/recipe-import.md)
- [Cloudflare deployment](docs/operations/cloudflare-deployment.md)
- [MongoDB gateway runbook](docs/migrations/mongodb-cutover-runbook.md)
- [Household accounts](docs/operations/household-accounts.md)
- [API and assistant integrations](docs/operations/api-and-integrations.md)

The OpenAPI 3.1 document is served by a running instance at `/api/v1/openapi.json`.

# Tableplan

Tableplan is a family meal planner built for Cloudflare Workers. It imports the
recipe catalog in `data/recipes_ingredients.csv`, supports authenticated recipe
discovery and favorites, builds weekly plans, and combines scaled ingredients
into US or metric shopping lists. The same data is available through a scoped
REST API and an MCP server for assistant clients.

## Quick Start

Prerequisites: Node.js 22 or newer and the source CSV in `data/`.

```bash
npm install
npm run db:migrate:local
npm run import:sample
npm run dev
```

Open `http://localhost:5173`, create a local account, and sign in. The sample
import scans the source file to select a deterministic 5,000-row sample, so its
first run takes several minutes.

Run the complete local quality gate with:

```bash
npm run check
```

## Documentation

- [Implementation progress](docs/implementation-progress.md)
- [Local development](docs/operations/local-development.md)
- [Recipe import](docs/operations/recipe-import.md)
- [API and assistant integrations](docs/operations/api-and-integrations.md)
- [Cloudflare deployment](docs/operations/cloudflare-deployment.md)
- [Phase documents](docs/phases/README.md)

The OpenAPI 3.1 document is served by a running instance at
`/api/v1/openapi.json`. Repository Agent Skills live under `src/skills/` and do
not contain credentials.


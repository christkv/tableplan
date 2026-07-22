# Initial setup

Tableplan uses MongoDB Atlas as its only deployed database. Cloudflare deploys the application and gateway code; it does not deploy MongoDB.

Choose the guide for the environment you are setting up:

- [Local development initial setup](docs/setup/local-development.md)
- [Preview environment setup](docs/setup/preview.md)
- [Production environment setup](docs/setup/production.md)

## Architecture

The application Worker never receives an Atlas URI. In preview and production it calls a private MongoDB gateway Worker through the `MONGODB_GATEWAY` Cloudflare service binding. One named Durable Object (`pool-0`) owns the bounded `MongoClient` pool and Better Auth runtime.

| Environment | Gateway | MongoDB database |
| --- | --- | --- |
| Local | Node gateway or local Durable Object Worker | `application_local` |
| Preview | `tableplan-mongodb-gateway-preview` | `application_preview` |
| Production | `tableplan-mongodb-gateway-production` | `application` |

## Rules shared by every environment

- Keep gateway runtime, importer, and schema/index administration credentials separate.
- Never put `MONGODB_URI` in the application Worker.
- Preview and production use private service bindings, not `MONGODB_GATEWAY_URL`.
- Keep the gateway and application service tokens identical within one environment and different across environments.
- Review index synchronization in dry-run mode before applying it.
- Keep storage-contract changes backward-compatible during the gateway-first rollout window.
- Do not share databases, credentials, auth secrets, OAuth clients, buckets, or queues between preview and production.

The MongoDB driver and BSON are intentionally pinned to `7.2.0` for Cloudflare Worker compatibility. `MongoGatewayDO` uses a SQLite-backed Durable Object namespace, including on Workers Free accounts, but stores no application data in Cloudflare SQLite.

Operational references:

- [Cloudflare deployment](docs/operations/cloudflare-deployment.md)
- [MongoDB gateway runbook](docs/migrations/mongodb-cutover-runbook.md)
- [Recipe import](docs/operations/recipe-import.md)
- [Local development operations](docs/operations/local-development.md)

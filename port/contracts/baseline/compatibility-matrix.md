# Compatibility Matrix

| Capability | Current behavior | Spring Boot policy | Phase |
| --- | --- | --- | --- |
| User/aggregate IDs | String UUID | Preserve exactly; reject missing/non-string IDs | 01/03 |
| Mongo schema | 28 named collections with validators/indexes | Preserve and reconcile explicitly | 01/08 |
| Atlas Search | `recipes_v1` | Preserve definition and verify asynchronously | 02/08 |
| API errors | `{code,message}` with route-specific variation | Superset with `requestId` and optional `fieldErrors` | 01 |
| Recipe paths | `/api/v1/recipes/*` | Preserve | 02 |
| Better Auth identities | Mongo `users` and `accounts` | Preserve user IDs and verified provider IDs | 03 |
| Active sessions | Durable Objects | Deliberately invalidate at cutover | 03/09 |
| Password hashes | Better Auth account records | Verify algorithm before direct compatibility claim | 03 |
| API keys | `mp_test_`/`mp_live_`, hashed | Preserve only after exact format verification | 04 |
| Plan dates | ISO date strings | Preserve; never migrate to BSON Date | 05 |
| Background work | Cloudflare Agents/Workflows/Queues | Mongo-leased jobs with bounded worker pool | 06 |
| Artifacts | R2 bindings | AWS SDK v2 S3-compatible adapter; bounded local adapter for development | 06 |
| Email | Cloudflare email binding | SMTP adapter plus durable delivery state; safe capture adapter locally | 07 |
| PDF | Browser Rendering | In-process Apache PDFBox 3.0.8 renderer; no startup browser download | 07 |
| MCP | Streamable HTTP at `/mcp` | Small stateless JSON-RPC adapter, protocol `2025-11-25`, 17 frozen tools | 08 |
| Deployment | Worker plus gateway Worker | One Spring Boot JAR plus embedded SPA | 09 |

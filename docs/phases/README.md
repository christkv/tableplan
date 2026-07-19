# Implementation Phases

Date: 2026-07-17

This directory is the execution-level roadmap for the family meal planner. Each phase is a separately deliverable milestone with explicit dependencies, scope, verification, and exit criteria.

## Planning Decisions

- The canonical roadmap has 15 phases numbered 0 through 14.
- Local development and Cloudflare deployment use the same application and domain services; only service bindings differ.
- Phase 2 imports a deterministic sample for product development. The full 500,471-row production import is delayed until Phase 11, after schema and search contracts are stable.
- Favorites are included in Phase 3 so the first recipe experience supports discovery, drill-down, and saving.
- Unit conversion is completed before shopping-list generation because aggregation depends on normalized quantities.
- REST API contracts precede MCP and skills. UI, REST, MCP, and import workflows call shared domain services rather than each other.
- API keys are suitable for local development and server-to-server access. User-facing ChatGPT and Claude connections use OAuth before production distribution.
- Vector search is an enhancement to a working FTS and filter system, not a prerequisite for recipe discovery.

## Phase Map

| Phase | Document | Primary outcome | Depends on |
| --- | --- | --- | --- |
| 0 | [Project Bootstrap](phase-00-project-bootstrap.md) | Running local and Cloudflare application skeleton | None |
| 1 | [Schema, Auth, and Authorization](phase-01-schema-auth-authorization.md) | Secure users, households, and foundational schema | Phase 0 |
| 2 | [Import Tool MVP](phase-02-import-tool-mvp.md) | Repeatable sample import with QA reporting | Phase 1 |
| 3 | [Recipe Browser and Search](phase-03-recipe-browser-search.md) | Search, recipe detail, and favorites | Phase 2 |
| 4 | [Units and Quantity Engine](phase-04-units-quantity-engine.md) | Safe scaling, conversion, and aggregation | Phase 2 |
| 5 | [Meal Planning and Shopping Lists](phase-05-meal-planning-shopping-lists.md) | End-to-end weekly planning workflow | Phases 3-4 |
| 6 | [REST API, API Keys, and OpenAPI](phase-06-rest-api-keys-openapi.md) | Stable external API with scoped access | Phase 5 |
| 7 | [MCP Server](phase-07-mcp-server.md) | Claude and ChatGPT-compatible tool server | Phase 6 |
| 8 | [ChatGPT and Claude UX](phase-08-chatgpt-claude-ux.md) | Tested user-facing assistant connections | Phase 7 |
| 9 | [Agent Skills](phase-09-agent-skills.md) | Portable API, MCP, and import skills | Phases 6-8 |
| 10 | [Vector and Hybrid Search](phase-10-vector-hybrid-search.md) | Semantic recipe discovery with FTS fallback | Phase 3 |
| 11 | [Full Import and Production Launch](phase-11-full-import-production.md) | Reproducible full-catalog production release | Phases 6, 7, 10 |
| 12 | [Hardening and Operations](phase-12-hardening-operations.md) | Operational, security, and recovery readiness | Phase 11 |
| 13 | [Private Recipe Ingestion](phase-13-private-recipe-ingestion.md) | Reviewed text/file/image extraction into private recipes | Phases 3-7; OpenRouter, Cloudflare AI, R2, Agents, and Workflows |
| 14 | [PDF, Email, and Public Checklists](phase-14-pdf-email-public-checklists.md) | Printable exports and a secure login-free store checklist | Phases 4-6; Browser Rendering, Email Service, and Queues |

## Cross-Phase Rules

- A phase is complete only when its acceptance criteria pass locally and, where applicable, in preview.
- Schema changes use migrations and include rollback or forward-fix notes.
- Household-owned data is checked at the service boundary, not only in route handlers.
- Parsed source data always retains its original representation and parse status.
- New domain behavior has unit tests; cross-service workflows have integration tests; critical user workflows get browser smoke tests.
- Generated artifacts, local databases, source data copies, secrets, and live API keys are not committed.

## Decision Gates

| Decision | Required by | Default if not changed |
| --- | --- | --- |
| Email verification and password-reset provider | Phase 1 preview completion | Define the adapter in Phase 1; select the provider before public first-party signup |
| One or multiple households per user | Phase 1 schema freeze | One household per user for MVP, while retaining a membership model that can expand |
| Public versus authenticated recipe search | Phase 3 | Authenticated access only |
| Personal versus household-owned API keys | Phase 6 | Personal creator with an explicit household binding |
| Initial ChatGPT distribution model | Phase 8 | Private/internal preview before public distribution |
| Nutrition enrichment | Phase 11 scope freeze | Post-MVP; preserve schema extension points only |
| Private recipe default visibility | Phase 13 schema migration | User-private; require explicit household sharing before shared planning |
| Public shopping-link lifetime | Phase 14 capability migration | 14 days, user-selectable from 3, 7, 14, or 30 days, with immediate revocation |

## Release Gates

- **Usable local prototype:** through Phase 5.
- **External developer preview:** through Phase 7.
- **Assistant integration preview:** through Phase 9.
- **Semantic-search preview:** through Phase 10.
- **Production catalog launch:** through Phase 11.
- **Operational readiness:** Phase 12.
- **Printable and shareable planning:** Phase 14.

The application-level product and architecture context remains in [the application plan](../meal-planner-application-plan.md). The condensed cross-phase roadmap remains in [the phased implementation plan](../phased-implementation-plan.md).

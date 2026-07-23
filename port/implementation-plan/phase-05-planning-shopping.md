# Phase 05 — Meal Planning and Shopping

## Objective

Port Tableplan's core collaborative workflow: weekly meal plans, serving and slot changes,
shopping-list generation/refresh, and checked state. Preserve quantity behavior, household
isolation, and correctness under concurrent edits.

## Scope

- Plan week/date navigation and configurable slots.
- Create/get/update/copy meal plans.
- Add/remove/move/update plan items and servings.
- Generate, refresh, view, and toggle shopping lists.
- Quantity parsing/conversion/aggregation/formatting.
- `/plan` and `/shopping` SPA routes.
- Transactions or compare-and-set guards for identified races.

Public shopping shares, email, and PDFs are Phase 07.

## Domain invariants

Write these as executable tests before repositories/controllers:

- Plan dates remain ISO `YYYY-MM-DD` strings in BSON and API date fields.
- Week boundaries use the household IANA timezone and accepted first-day rules.
- A household has at most one canonical plan for a defined week if that is current behavior.
- Plan slot IDs must belong to the active household configuration.
- Recipe visibility is rechecked when adding or reading plan items.
- Serving values respect accepted precision and bounds.
- Shopping aggregation combines only compatible units and preserves unconvertible lines.
- Refresh retains checked state according to the current stable matching rule.
- Every query/mutation is scoped by household and role.

## Workstream 1: pure domain port

- [ ] Port quantity tokenizer/parser including fractions, decimals, ranges, and invalid input.
- [ ] Port unit alias resolution, compatibility, conversion, aggregation, and display
      formatting.
- [ ] Port plan week/date and timezone rules.
- [ ] Port slot validation and plan item ordering.
- [ ] Port shopping line normalization, aggregation, exclusions, and checked-state retention.
- [ ] Run shared golden fixtures in both TypeScript and Kotlin and classify all differences.
- [ ] Add property-based tests for conversion round trips and aggregation associativity where
      mathematically valid.

No Spring, Mongo, locale-default, or system-clock dependency is allowed in this workstream.

## Workstream 2: planning persistence and application services

- [ ] Map `meal_plans` and embedded item documents with string IDs.
- [ ] Implement get-or-create for a household/week using a unique index and retry-safe logic.
- [ ] Implement add/remove/move/update/servings/copy use cases.
- [ ] Define an aggregate version or compare-and-set token for conflicting edits.
- [ ] Use native driver positional/array-filter updates where they avoid lost updates.
- [ ] Revalidate membership, role, slot, and recipe visibility inside each application use
      case.
- [ ] Make copy and create idempotent through request idempotency where duplicate submission
      is plausible.
- [ ] Emit mutation events only where already required for audit/integration behavior.

## Workstream 3: shopping persistence and services

- [ ] Map `shopping_lists` and embedded items.
- [ ] Generate a deterministic list from the selected plan and preferences.
- [ ] Refresh with stable identity matching that retains checked state per baseline.
- [ ] Implement toggle/update operations with item-level compare-and-set or version checks.
- [ ] Prevent an older refresh from overwriting newer toggles.
- [ ] Handle recipes that change or disappear after being placed on a plan.
- [ ] Bound list/item sizes and return explicit validation errors.
- [ ] Keep share token fields out of normal authenticated DTOs.

## Workstream 4: transactions and concurrency

- [ ] Test two simultaneous first-plan creations for the same household/week.
- [ ] Test add/remove/update races on distinct and identical plan items.
- [ ] Test plan copy retries and idempotency-key replay.
- [ ] Test two shopping refreshes and refresh racing a toggle.
- [ ] Test membership/role removal during a write.
- [ ] Add transaction retry only where multiple documents must commit together; do not use a
      transaction as a substitute for a unique index or version check.
- [ ] Return deterministic `409` responses when automatic conflict resolution is unsafe.

## Workstream 5: MVC contracts

- [ ] Complete plan/shopping request, response, embedded item, version, and error schemas.
- [ ] Validate date-only strings strictly without converting them to server-local dates.
- [ ] Validate maximum item counts, servings, notes, and client-provided text.
- [ ] Require idempotency keys on selected create/copy/generate operations if the baseline
      warrants it.
- [ ] Use session and API-key principals with explicit scopes/roles.
- [ ] Ensure no raw ODM document or Mongo update result is serialized.

## Workstream 6: React/Vite

- [ ] Port `/plan` with week navigation, slot layout, recipe selection, serving changes,
      ordering, copy, and responsive states.
- [ ] Port `/shopping` with generation, refresh, group/order behavior, and accessible toggles.
- [ ] Define client state ownership so mutation results do not conflict with loader
      revalidation.
- [ ] Handle `409` with refresh/reapply guidance rather than silently overwriting.
- [ ] Preserve keyboard and touch interactions.
- [ ] Test household/timezone switching while pages are open.

## Testing

- Pure unit and golden fixture suite for all quantity/date/aggregation behavior.
- Repository tests against replica-set Mongo for unique plans, array updates, versions, and
  transactions.
- API contract tests for valid/invalid dates, roles, limits, conflicts, and idempotency.
- Security tests for cross-household plan/list/item IDs and invisible recipes.
- Concurrency suite listed above.
- Browser E2E for complete plan-to-shopping workflow, reload, second browser session, and
  conflict recovery.
- Load test broad plan reads, list generation, refresh, and toggle bursts at expected
  household sizes.

## Observability

- Plan mutation duration/conflicts and idempotency replays.
- Shopping generation/refresh duration, recipe/item counts, and conversion warning counts.
- Transaction retries/failures by safe use-case name.
- Mongo pool wait and update conflict counts.
- Do not label metrics with household, recipe, plan, or item identifiers.

## Deliverables

- Authoritative Kotlin quantity/planning/shopping domain library.
- Meal-plan and shopping application/repository/API slices.
- `/plan` and `/shopping` SPA routes.
- Cross-runtime domain parity report.
- Concurrency/load evidence and conflict behavior runbook.

## Risks and controls

| Risk | Control |
| --- | --- |
| Timezone conversion shifts plan dates | Preserve ISO date-only BSON/API values and inject zone explicitly |
| Refresh loses checked items | Golden fixtures plus stable matching and race tests |
| Concurrent edits overwrite each other | Aggregate versions, targeted updates, and deterministic `409` |
| Quantity port subtly diverges | Shared fixtures and property-based tests before UI migration |
| Query misses household filter | Repository guard tests with colliding IDs across households |

## Exit gate

Phase 05 is complete when golden fixtures match accepted behavior; concurrent creation,
editing, refresh, and toggles do not lose data silently; serving changes propagate correctly;
checked items are retained; and all plan/shopping access remains household-isolated.

## Handoff to Phase 06

Provide quantity/recipe normalization services, idempotency and conflict conventions,
transaction utilities, and the plan/shopping data needed for export workflows.


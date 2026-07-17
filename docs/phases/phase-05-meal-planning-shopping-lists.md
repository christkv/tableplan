# Phase 5: Meal Planning and Shopping Lists

## Objective

Complete the primary family workflow: plan meals for a date range, set servings, and generate one combined, editable shopping list with safe measurement conversion.

## Dependencies

- Phase 3 recipe discovery and favorites.
- Phase 4 scaling and aggregation engine.
- Phase 1 household authorization.

## Deliverables

- Weekly planner with date navigation and meal slots.
- Add-to-plan flows from search, recipe detail, and favorites.
- Per-item servings, notes, leftovers indicator, and move/remove actions.
- Copy-week and duplicate-item operations with clear date behavior.
- Shopping-list generation for a selected plan and date range.
- Aggregated and unresolved shopping items with recipe attribution.
- Manual item creation, edit, check/uncheck, delete, and category grouping.
- Household-shared live state using normal reload/mutation behavior; real-time sync is optional.
- Mobile-first shopping interaction suitable for use in a store.

## Domain Behavior

- A meal plan belongs to one household and has an explicit timezone.
- Plan items reference immutable recipe IDs and record planned servings.
- Generation creates a shopping-list snapshot. Later plan changes do not silently rewrite an existing list.
- Regeneration is an explicit operation with a preview of additions, removals, and changed quantities.
- Checked state and manual items survive regeneration unless the user chooses replacement.
- Shopping items retain source plan items and recipes for audit and display.
- Display-system changes reformat values and do not recalculate from rounded display values.

## Implementation Sequence

1. Implement meal-plan repositories and household-scoped services.
2. Build week navigation, slots, and add/edit/remove interactions.
3. Add serving overrides and connect scaling previews.
4. Implement shopping-list snapshot generation through the Phase 4 engine.
5. Build list grouping, manual items, checked state, and source drill-down.
6. Add regeneration diff behavior.
7. Add responsive and accessibility refinements for repeated mobile use.

## Verification

- Unit tests for timezone/date-range logic and copy-week behavior.
- Integration tests for plan mutation and list generation from known recipes.
- Snapshot/golden tests for deterministic aggregate output.
- Authorization tests for owner, adult, viewer, and a second household.
- Browser test: search recipe, plan week, change servings, generate list, check item.
- Mobile tests for long ingredient names, large quantities, and offline/error recovery states.

## Acceptance Criteria

- A household member can build a week from search results and favorites.
- An empty week can copy the immediately previous week while preserving weekday,
  slot, servings, notes, and leftovers; populated target weeks are never merged.
- Planned servings control generated quantities.
- A date range produces one deterministic combined shopping list.
- Unresolved ingredient lines and source recipes are always visible.
- Adults can edit household plans/lists; viewers cannot mutate them.
- Regeneration never silently discards manual items or checked state.
- The primary shopping workflow is usable at a narrow mobile viewport.

## Non-Goals

- Pantry subtraction.
- Store-specific aisle maps, prices, or package recommendations.
- Real-time collaborative cursors or push synchronization.
- AI-generated meal plans.

## Exit Artifact

A complete local product loop from recipe discovery through a household shopping list.

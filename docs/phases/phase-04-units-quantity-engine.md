# Phase 4: Units and Quantity Engine

## Objective

Create a deterministic domain engine for parsing, scaling, displaying, converting, and aggregating recipe quantities without inventing unsafe conversions or dropping unresolved source data.

## Dependencies

- Phase 2 normalized ingredient lines and parser fixtures.
- Phase 1 unit and recipe-ingredient schema.

This phase may run in parallel with Phase 3 after Phase 2 is stable.

## Deliverables

- Typed unit registry for mass, volume, count, package, and temperature.
- Alias registry covering common dataset spellings and abbreviations.
- Exact quantity representation for integers, decimals, fractions, mixed numbers, and ranges.
- Serving scale calculation and ingredient-line scaling.
- US, metric/EU, and original display modes.
- Ingredient-aware conversion policy with optional density records.
- Aggregation engine that groups compatible ingredients and retains source attribution.
- Formatting rules suitable for recipe detail, shopping lists, API JSON, and MCP structured output.

## Domain Rules

- Store mass in grams and volume in milliliters; retain the parsed source quantity and unit.
- Convert only within a shared dimension by default.
- Never convert volume to mass without an explicit ingredient density and confidence/source metadata.
- Keep package and count units separate unless a package size creates a safe underlying quantity.
- Represent ranges as minimum and maximum values; do not collapse them to a midpoint.
- Preserve `to taste`, `as needed`, unknown quantities, and failed parses as visible unresolved lines.
- Preparation text affects grouping when meaningful, for example chopped versus whole when combining would confuse the shopper.
- Use rational or decimal-safe arithmetic rather than binary floating-point for user-visible quantities.

## Aggregation Key

An item can merge only when these properties are compatible:

```text
canonical ingredient
unit dimension
preparation/grouping policy
package semantics
resolution status
```

Every aggregate retains contributing recipe ID, recipe name, plan item ID when available, original line, and scaled quantity.

## Implementation Sequence

1. Define quantity, unit, dimension, conversion, and unresolved-result types.
2. Populate unit aliases and exact conversion factors.
3. Implement quantity parsing and canonical formatting.
4. Implement serving scaling with explicit rounding policy.
5. Implement same-dimension conversion and display-system selection.
6. Add optional density conversion behind a clear policy boundary.
7. Build aggregation and source-attribution output.
8. Integrate the display layer into recipe detail without changing stored source values.

## Verification

- Table-driven tests for aliases, fractions, mixed numbers, decimals, ranges, and package sizes.
- Property tests for reversible same-dimension conversion within defined precision.
- Golden tests for US and metric formatting.
- Aggregation tests for mergeable, incompatible, and unresolved lines.
- Tests proving no volume-to-mass conversion occurs without density.
- Regression fixtures drawn from frequent and problematic dataset lines.

## Acceptance Criteria

- Scaling a recipe from 4 to 6 servings updates every parsed quantity by exactly 1.5.
- US and metric displays are consistent and do not mutate persisted source quantities.
- The Settings measurement selector persists the user and household default;
  recipe details and shopping lists use that preference.
- Compatible mass and volume items aggregate deterministically.
- Incompatible package/count items remain separate with understandable labels.
- Every unresolved line remains visible and attributable to its source recipe.
- Domain tests run without Cloudflare bindings, D1, or UI dependencies.

## Non-Goals

- Automated density coverage for the full ingredient catalog.
- Nutrition calculations.
- Grocery store package optimization.
- Temperature conversion in all recipe prose; the registry may support it for later use.

## Exit Artifact

A standalone quantity and unit engine that Phase 5 can trust for shopping-list generation.

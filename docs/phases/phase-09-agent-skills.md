# Phase 9: Agent Skills

## Objective

Package concise, portable instructions that teach compatible assistants how to use the meal-planner API, MCP tools, and import administration workflows safely and consistently.

## Dependencies

- Phase 6 stable OpenAPI contract.
- Phase 7 stable MCP tool names and schemas.
- Phase 8 validated assistant workflows and failure cases.

## Deliverables

- Canonical skill sources under `src/skills/`.
- `meal-planner-api` skill for direct REST workflows.
- `meal-planner-mcp` skill for connected tool workflows.
- `meal-planner-import-admin` internal skill for import and QA operations.
- Generation and validation script for supported packaging targets.
- Claude Code project-skill output and OpenAI-compatible skill archive where supported.
- Versioning policy tied to API and MCP contract versions.

## Canonical Layout

```text
src/skills/
  meal-planner-api/
    SKILL.md
    references/
    scripts/
  meal-planner-mcp/
    SKILL.md
    references/
  meal-planner-import-admin/
    SKILL.md
    references/
    scripts/
```

Generated artifacts are build outputs and should not become competing hand-edited sources.

## Skill Responsibilities

### API Skill

- Explain base URL selection and bearer authentication without embedding credentials.
- Reference OpenAPI as the field-level source of truth.
- Provide concise search, plan, and shopping-list workflows.
- Describe pagination, idempotency, scopes, and error handling.

### MCP Skill

- Prefer MCP tools when the server is connected.
- Search before using a recipe ID and read a plan before changing it.
- Use explicit dates, meal slots, and servings.
- Review mutation results and avoid repeating successful writes.

### Import Admin Skill

- Remain internal and require the `admin:import` authority boundary.
- Define analyze, sample, stage, normalize, QA, export, and apply workflow.
- State quality gates and stop conditions.
- Never recommend production replacement without reviewed QA and a recovery plan.

## Implementation Sequence

1. Extract proven workflows and common errors from Phase 8 evaluations.
2. Author the MCP skill first, then API and import-admin skills.
3. Add only supporting references/scripts that materially reduce ambiguity.
4. Build packaging and lint validation.
5. Test each skill in a clean assistant context without repository knowledge.
6. Add contract-version checks to detect stale endpoint or tool references.

## Verification

- Validate required metadata and package structure for each target.
- Scan generated artifacts for API-key patterns and environment secrets.
- Run representative recipe search, weekly plan, shopping list, and read-only research evaluations.
- Verify the import skill stops on failed QA thresholds.
- Test version mismatch behavior when API/tool contracts change.
- Ensure instructions remain useful within a modest context budget.

## Acceptance Criteria

- Each skill has a clear trigger, narrow responsibility, and tested workflow.
- No skill contains a real key, token, household ID, or production-only secret.
- API and MCP examples use placeholders and current contract names.
- Assistants following the skills do not duplicate writes during the standard evaluation suite.
- Generated packages are reproducible from canonical sources.

## Non-Goals

- Treating skills as an authorization mechanism.
- Duplicating the full API reference inside skill prose.
- Public distribution before product and privacy review.

## Exit Artifact

Versioned skill packages that make the API and MCP integrations easier and safer to use from compatible assistants.

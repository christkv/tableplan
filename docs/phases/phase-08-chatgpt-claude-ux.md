# Phase 8: ChatGPT and Claude Integration UX

## Objective

Turn the working MCP server into understandable, testable user experiences in ChatGPT and Claude. The integration should make reads easy, mutations reviewable, and account connection clear.

## Dependencies

- Phase 7 remote MCP endpoint and OAuth flow.
- Preview environment with representative recipe, plan, and shopping-list data.

## Deliverables

- ChatGPT developer-mode app configuration connected to the preview MCP server.
- Tool-linked ChatGPT UI components where they materially improve review:
  - Compact recipe search results.
  - Recipe detail/ingredient preview.
  - Weekly plan summary.
  - Shopping-list preview and status.
- Claude Code remote MCP setup and verification instructions.
- Claude web/desktop connector instructions for supported account/workspace configurations.
- User-facing account connection, permission, disconnect, and troubleshooting documentation.
- Conversation-level evaluation suite for common read and write workflows.

## Interaction Principles

- Searching and reading may happen immediately after user intent is clear.
- Plan and shopping-list mutations show concrete dates, recipe IDs/names, servings, and household before completion.
- Ambiguous relative dates are resolved using household timezone and echoed back as explicit dates.
- Bulk operations return a preview or compact change summary.
- Assistant UI remains a complement to the main app; every created resource is visible and editable in the web application.
- Secrets and API keys never appear in assistant messages or UI component state.

## Core Scenarios

1. Find several recipes using text, ingredient, and dietary constraints.
2. Inspect one recipe and scale it for a family size.
3. Add selected recipes to specific dates and meal slots.
4. Generate a combined list for an explicit date range.
5. Read and update shopping-list item state.
6. Explain a partial-data or unresolved-quantity result without hiding it.

## Implementation Sequence

1. Register the preview MCP server in ChatGPT developer mode and a Claude client.
2. Run text-only tools first and record integration defects.
3. Add minimal tool-linked UI components for high-value review surfaces.
4. Implement OAuth consent copy and connection management.
5. Build scripted prompt evaluations and expected tool-call assertions.
6. Document local tunnel, preview, and production connection procedures.
7. Complete privacy, terms, support, and distribution prerequisites before any public listing.

## Verification

- End-to-end tests for each core scenario in ChatGPT and at least one Claude surface.
- Confirm read-only questions do not trigger write tools.
- Confirm mutation prompts produce the intended dates, servings, and household resources.
- Test denied consent, expired tokens, disconnected accounts, and server errors.
- Validate component layouts with long recipe names and shopping items.
- Review all assistant-visible descriptions for prompt-injection-sensitive or misleading content.

## Acceptance Criteria

- A connected ChatGPT user can search, plan meals, and generate a shopping list against preview data.
- Claude Code can connect to local and preview endpoints using documented steps.
- OAuth connection and disconnection behave predictably without exposing credentials.
- Mutations are easy to review from returned structured data and linked app resources.
- Automated evaluations detect missing calls, wrong dates, unsafe write behavior, and oversized responses.

## Non-Goals

- Public marketplace/listing approval as a prerequisite for phase completion.
- Reimplementing the full meal-planner UI inside a chat client.
- Assistant-generated recipes or nutrition advice.

## Exit Artifact

Validated ChatGPT and Claude integrations ready for private/internal preview and later production distribution.

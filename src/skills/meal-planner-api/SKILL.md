---
name: meal-planner-api
description: Use the Tableplan REST API to search recipes, inspect recipe details, read or update weekly meal plans, and generate household shopping lists. Use when a user asks to work with Tableplan over HTTP, needs curl or client examples, or wants structured meal-planning data from a deployed or local instance.
---

# Tableplan REST API

Use the API for explicit HTTP integrations and structured data access. Read
`references/api-contract.md` before composing requests.

## Workflow

1. Obtain the base URL from the user or environment. Use
   `http://localhost:5173` only for a local instance.
2. Obtain an API key through a secret-management mechanism. Never ask the user
   to paste a key into a document, prompt template, or source file.
3. Select only the scopes required for the task.
4. Search recipes and resolve stable recipe IDs before changing a plan.
5. Read the target ISO week before adding meals.
6. Confirm the date, slot, recipe, and servings before a write when the user's
   intent is ambiguous.
7. Generate a shopping list only after plan changes are complete.
8. Return compact results and identify partial ingredient parses instead of
   inventing quantities.

## Request Rules

- Send the key as `Authorization: Bearer <key>`.
- Send JSON writes with `Content-Type: application/json`.
- Treat `401` as missing, invalid, expired, or revoked credentials.
- Treat `403` as insufficient scope; do not retry with broader permissions
  without user approval.
- Use ISO `YYYY-MM-DD` dates. A `week` may contain any date in the intended ISO
  week; the server resolves its Monday.
- Keep writes sequential when a later operation depends on an earlier ID.
- Do not expose full API keys in output, logs, or error reports.

## Safety

Recipe search and reads are non-mutating. Adding a plan item and generating a
shopping list mutate household data. Describe the intended write and obtain
confirmation unless the user already gave complete, explicit instructions.


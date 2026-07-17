# Phase 1: Schema, Auth, and Authorization

## Objective

Establish the relational model and access-control boundary for personal and household data. Users can authenticate, receive a household, and access only resources permitted by their membership and role.

## Dependencies

- Phase 0 project and runtime configuration.
- Google OAuth credentials for preview testing.
- A chosen email delivery provider may be deferred, but its adapter contract must be defined.

## Deliverables

- Versioned D1 migrations for auth-adjacent and application tables.
- Better Auth with Google, email/password, username, and D1 integration.
- Local development authentication that cannot be enabled in preview or production by accident.
- First-login household creation and user profile setup.
- Household membership roles: `owner`, `adult`, and `viewer`.
- Authorization helpers for session users, household membership, role checks, and future API scopes.
- Security event logging for sign-in and membership changes.

## Schema Scope

Create the initial versions of:

- `households`, `household_members`, `household_preferences`, `user_profiles`.
- `recipes`, `recipe_steps`, `recipe_raw_ingredients`, `ingredients`, `ingredient_aliases`, `recipe_ingredients`.
- `units`, `tags`, `recipe_tags`, `favorites`, `collections`, `collection_recipes`.
- `meal_plans`, `meal_plan_items`, `shopping_lists`, `shopping_list_items`.
- `api_keys`, `api_key_events`, `import_runs`, `import_issues`, `import_metrics`.

Tables needed only by later phases may begin with minimal columns, but identifiers, ownership fields, timestamps, and foreign-key behavior must be decided here. Better Auth owns its own tables.

## Authorization Model

- Recipes imported from the shared dataset are globally readable to authenticated users.
- Favorites are user-owned and may reference globally readable recipes.
- Collections, plans, shopping lists, and preferences are household-owned.
- Household owners manage membership and destructive household actions.
- Adults can edit plans and lists; viewers are read-only.
- Every household query includes household identity at the repository or domain-service boundary.

Required guards:

```text
requireUser
requireHouseholdMember
requireHouseholdRole
requireApiScope
```

## Implementation Sequence

1. Write schema conventions and initial migrations.
2. Configure Better Auth and cookie/session behavior for local and preview URLs.
3. Implement Google and first-party account flows.
4. Add atomic first-login household and profile creation.
5. Add authorization services and route guards.
6. Add account/settings pages for profile and household basics.
7. Add email verification/password-reset adapter boundaries; enable delivery when provider credentials exist.

## Verification

- Migration apply tests against a fresh local D1 database.
- Authentication tests for session creation, invalid credentials, and logout.
- Authorization matrix tests covering each role and resource type.
- Cross-household negative tests using valid users from two households.
- Preview OAuth callback smoke test.
- Verify development auth bypass is rejected outside local mode.

## Acceptance Criteria

- A user can create a first-party account and sign in locally.
- Google sign-in succeeds in preview.
- First sign-in creates exactly one profile, household, and owner membership even when retried.
- Session and API-key authentication types can be distinguished by shared request context.
- Cross-household access and viewer writes return consistent authorization errors.
- All schema can be recreated from migrations alone.

## Non-Goals

- Household invitations by email beyond the minimum schema/contract.
- API-key issuance UI.
- Account deletion and full export workflows.
- Child profiles or granular per-member dietary preferences.

## Exit Artifact

A secure identity and household foundation with a stable schema ready for data import.

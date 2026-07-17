# REST Contract

Base path: `<origin>/api/v1`

Authentication: `Authorization: Bearer <mp_test_... or mp_live_...>`.
Interactive browser sessions may use their secure session cookie. API keys are
shown once when created under **Settings > API access**.

## Endpoints

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | Service and database health |
| GET | `/openapi.json` | none | OpenAPI 3.1 document |
| GET | `/recipes/search?q=&ingredient=&tag=&tagMatch=&scope=&limit=` | `recipes:read` | Search accessible recipes; repeat exact `tag` and optionally scope ownership |
| GET | `/recipes/{recipeId}?servings=` | `recipes:read` | Get recipe detail with optional scaled parsed quantities |
| POST | `/recipe-ingestions` | `recipes:write` | Extract supplied text into an unpublished review draft |
| GET | `/recipe-ingestions/{ingestionId}` | `recipes:read` | Poll an owned job and read its draft/mappings |
| POST | `/recipe-ingestions/{ingestionId}` | `recipes:write` | Publish an approved draft, private by default |
| GET | `/saved-searches` | `recipes:read` | List household saved recipe searches |
| POST | `/saved-searches` | `recipes:write` | Create or replace a named search |
| DELETE | `/saved-searches/{savedSearchId}` | `recipes:write` | Delete a household saved search |
| GET | `/meal-plans?week=YYYY-MM-DD` | `plans:read` | Get household week and configured meal sections |
| POST | `/meal-plans` | `plans:write` | Add a recipe to a plan |
| PATCH | `/meal-plan-items/{itemId}` | `plans:write` | Change planned servings and refresh its shopping list |
| POST | `/meal-plans/clone-previous` | `plans:write` | Copy the previous week into an empty target week |
| POST | `/shopping-lists/generate` | `shopping:write` | Generate list snapshot |
| GET | `/shopping-lists/latest` | `shopping:read` | Get latest list |

`POST /meal-plans` JSON fields: `week`, `recipeId`, `date`, `slot`, and positive
`servings`. Read `mealSlots` from `GET /meal-plans` and use one of its stable
IDs as `slot`; labels and ordering are household-configurable.

`PATCH /meal-plan-items/{itemId}` accepts positive `servings` from 0.25 through
100. The linked shopping list is recalculated under its existing ID and retains
checked items. Shopping-list reads include source-plan name, date range, and
meal count.

`GET /recipes/{recipeId}?servings=6` returns `selectedServings`, `servingScale`,
and adjusted `quantityMin`/`quantityMax` values. Unresolved lines retain their
original raw text and null normalized quantities.

`POST /meal-plans/clone-previous` requires `targetWeek`. It preserves weekday,
slot, servings, notes, and leftovers and returns `409` if the source is empty or
the target already contains meals.

`POST /shopping-lists/generate` JSON fields: `planId`, `week`, and optional
`measurementSystem` (`original`, `us`, or `metric`).

`POST /saved-searches` JSON fields: required `name` plus optional `query`,
`ingredient`, `tags` (up to 12 exact values), and `tagMatch` (`all` or `any`).

`POST /recipe-ingestions` accepts `text` and optional `filename`. Poll until
`review_ready`, present the draft to the user, then publish. Publication accepts
optional reviewed `draft`, `ingredientSelections`, and `visibility`.
`user_private` is the default; require explicit confirmation for `household`.

Errors use `{ "code": string, "message": string }`. Do not retry `4xx` writes
without correcting the request. See the live OpenAPI document for the canonical
machine-readable shape.

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
| GET | `/recipes/search?q=&ingredient=&tag=&tagMatch=&limit=` | `recipes:read` | Search catalog; repeat exact `tag`, matching `all` by default or `any` |
| GET | `/recipes/{recipeId}` | `recipes:read` | Get recipe detail |
| GET | `/saved-searches` | `recipes:read` | List household saved recipe searches |
| POST | `/saved-searches` | `recipes:write` | Create or replace a named search |
| DELETE | `/saved-searches/{savedSearchId}` | `recipes:write` | Delete a household saved search |
| GET | `/meal-plans?week=YYYY-MM-DD` | `plans:read` | Get household week |
| POST | `/meal-plans` | `plans:write` | Add a recipe to a plan |
| POST | `/meal-plans/clone-previous` | `plans:write` | Copy the previous week into an empty target week |
| POST | `/shopping-lists/generate` | `shopping:write` | Generate list snapshot |
| GET | `/shopping-lists/latest` | `shopping:read` | Get latest list |

`POST /meal-plans` JSON fields: `week`, `recipeId`, `date`, `slot`, and positive
`servings`. Slots are `breakfast`, `lunch`, `dinner`, or `snack`.

`POST /meal-plans/clone-previous` requires `targetWeek`. It preserves weekday,
slot, servings, notes, and leftovers and returns `409` if the source is empty or
the target already contains meals.

`POST /shopping-lists/generate` JSON fields: `planId`, `week`, and optional
`measurementSystem` (`original`, `us`, or `metric`).

`POST /saved-searches` JSON fields: required `name` plus optional `query`,
`ingredient`, `tags` (up to 12 exact values), and `tagMatch` (`all` or `any`).

Errors use `{ "code": string, "message": string }`. Do not retry `4xx` writes
without correcting the request. See the live OpenAPI document for the canonical
machine-readable shape.

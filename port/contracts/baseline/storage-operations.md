# Storage Operation Inventory

Source: `../src/storage/contract.ts`

| Area | Operations |
| --- | --- |
| System | `health` |
| Recipes | `searchRecipes`, `listRecipeTagFacets`, `getRecipe`, `setRecipeVisibility`, `updateOwnedRecipe` |
| Favourites | `isFavorite`, `setFavorite`, `listFavorites` |
| Preferences | `getMeasurementSystem`, `updateMeasurementSystem`, `getMealPlanSlots`, `updateMealPlanSlots` |
| Saved searches | `listSavedRecipeSearches`, `createSavedRecipeSearch`, `deleteSavedRecipeSearch` |
| Planning | `getMealPlan`, `getMealPlanById`, `getMealPlanItemContext`, `ensureMealPlan`, `addMealPlanItem`, `removeMealPlanItem`, `updateMealPlanItemServings`, `copyMealPlanWeek` |
| Shopping | `generateShoppingList`, `refreshShoppingListForPlan`, `refreshShoppingListsForRecipe`, `getLatestShoppingList`, `getShoppingListById`, `getShoppingListForPlan`, `toggleShoppingItem` |
| Shopping shares | `createShoppingShare`, `resolveShoppingShare`, `revokeShoppingShare`, `listShoppingShares`, `getPublicShoppingList`, `togglePublicShoppingItem`, `touchShoppingShare` |
| API keys | `createApiKey`, `listApiKeys`, `revokeApiKey`, `authenticateApiKey` |
| Ingestion | `createRecipeIngestion`, `attachRecipeSourceArtifact`, `updateRecipeIngestionStatus`, `saveRecipeIngestionDraft`, `getRecipeIngestion`, `getRecipeSourceArtifact`, `listIngredientCandidates`, `publishRecipeDraft` |
| Households | `ensureUserHousehold`, `getUserEmail`, `getHouseholdOverview`, `switchDefaultHousehold` |
| Invitations | `createHouseholdInvitationRecord`, `revokeHouseholdInvitation`, `resolveHouseholdInvitation`, `acceptHouseholdInvitation`, `claimHouseholdInvitationEmail`, `updateHouseholdInvitationDelivery` |
| Email | `createEmailDelivery`, `claimEmailDelivery`, `updateEmailDelivery`, `getEmailDelivery` |

The TypeScript interface contains 64 operations. Kotlin application ports may consolidate
transport-oriented calls, but all observable behavior must be assigned and tested.


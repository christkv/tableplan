import type { RecipeOrigin, RecipeVisibility } from "../domain/recipes";

export type RecipeIngestionStatus = "queued" | "extracting" | "review_ready" | "publishing" | "published" | "failed" | "cancelled";
export type RecipeInputKind = "text" | "image" | "document";

export interface RecipeDraft {
  title: string;
  description: string;
  servings: number | null;
  servingSize: string | null;
  ingredients: string[];
  steps: string[];
  tags: string[];
  warnings: string[];
}

export interface IngredientReview {
  position: number;
  rawLine: string;
  parsedName: string;
  ingredientId: string | null;
  mappingStatus: "mapped" | "unmapped" | "confirmed";
  mappingConfidence: number;
  rememberAlias: boolean;
}

export interface RecipeIngestionView {
  id: string;
  userId: string;
  householdId: string;
  inputKind: RecipeInputKind;
  origin: Exclude<RecipeOrigin, "dataset">;
  status: RecipeIngestionStatus;
  filename: string | null;
  mediaType: string | null;
  recipeId: string | null;
  progressMessage: string;
  errorCode: string | null;
  errorMessage: string | null;
  draft: RecipeDraft | null;
  ingredientReviews: IngredientReview[];
}

export interface PublishRecipeInput {
  ingestionId: string;
  userId: string;
  householdId: string;
  visibility: Extract<RecipeVisibility, "user_private" | "household">;
  draft: RecipeDraft;
  ingredientSelections: Array<{ position: number; ingredientId: string | null; rememberAlias: boolean }>;
}

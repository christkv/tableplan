export interface RecipeSummary {
  id: string;
  sourceId: string;
  name: string;
  description: string;
  servings: number | null;
  tags: string[];
  ingredients: string[];
  qualityFlags: string[];
}

export interface RecipeIngredient {
  id: string;
  position: number;
  rawLine: string;
  ingredient: string;
  quantityMin: string | null;
  quantityMax: string | null;
  unitId: string | null;
  preparation: string | null;
  parseStatus: "parsed" | "partial" | "unresolved";
}

export interface RecipeDetail extends RecipeSummary {
  servingSize: string | null;
  steps: { position: number; instruction: string; parseStatus: string }[];
  recipeIngredients: RecipeIngredient[];
}

export interface RecipeSearchInput {
  query?: string;
  tags?: string[];
  tagMatch?: RecipeTagMatch;
  /** @deprecated Use tags for multi-tag search. */
  tag?: string;
  ingredient?: string;
  limit?: number;
  offset?: number;
}

export type RecipeTagMatch = "all" | "any";

export interface RecipeSearchResult {
  recipes: RecipeSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface RecipeTagOption {
  name: string;
  recipeCount: number;
}

import type { RecipeInputKind } from "./types";

interface RecipeExtractionEnvironment {
  RECIPE_EXTRACTION_PROVIDER: string;
  OPENROUTER_API_KEY?: string;
}

export interface RecipeExtractionAvailability {
  available: boolean;
  code?: "openrouter_not_configured" | "openrouter_required";
  message?: string;
}

export function recipeExtractionAvailability(
  env: RecipeExtractionEnvironment,
  inputKind: RecipeInputKind,
): RecipeExtractionAvailability {
  if (env.RECIPE_EXTRACTION_PROVIDER === "local") {
    return inputKind === "text"
      ? { available: true }
      : {
        available: false,
        code: "openrouter_required",
        message: "Image and document extraction requires OpenRouter. Set RECIPE_EXTRACTION_PROVIDER=openrouter and configure OPENROUTER_API_KEY.",
      };
  }
  if (!env.OPENROUTER_API_KEY?.trim()) {
    return {
      available: false,
      code: "openrouter_not_configured",
      message: "OpenRouter extraction is selected but OPENROUTER_API_KEY is not configured.",
    };
  }
  return { available: true };
}

export class RecipeExtractionConfigurationError extends Error {
  constructor(readonly code: NonNullable<RecipeExtractionAvailability["code"]>, message: string) {
    super(message);
    this.name = "RecipeExtractionConfigurationError";
  }
}

export function assertRecipeExtractionAvailable(env: RecipeExtractionEnvironment, inputKind: RecipeInputKind): void {
  const availability = recipeExtractionAvailability(env, inputKind);
  if (!availability.available) throw new RecipeExtractionConfigurationError(availability.code!, availability.message!);
}

export type UnitDimension = "mass" | "volume" | "count" | "package" | "temperature";
export type MeasurementSystem = "original" | "us" | "metric";

export interface UnitDefinition {
  id: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  system: Exclude<MeasurementSystem, "original"> | "universal";
  toBase: number | null;
  aliases: readonly string[];
}

export interface QuantityRange {
  min: number;
  max?: number;
}

export interface ParsedIngredientLine {
  raw: string;
  quantity?: QuantityRange;
  unit?: UnitDefinition;
  ingredient: string;
  preparation?: string;
  status: "parsed" | "partial" | "unresolved";
}

export interface IngredientSource {
  recipeId: string;
  recipeName: string;
  rawLine: string;
}

export interface AggregationInput extends ParsedIngredientLine {
  canonicalIngredientId?: string;
  scale: number;
  source: IngredientSource;
}

export interface AggregatedIngredient {
  key: string;
  canonicalIngredientId?: string;
  name: string;
  quantity?: QuantityRange;
  unit?: UnitDefinition;
  preparation?: string;
  unresolved: boolean;
  sources: IngredientSource[];
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function startOfIsoWeek(value: string | Date = new Date()): string {
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return isoDate(date);
}

export function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function quantityText(min: string | null, max: string | null, unit: string | null): string {
  if (min === null) return "";
  const format = (value: string) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
  return `${format(min)}${max === null ? "" : `–${format(max)}`} ${unit ?? ""}`.trim();
}

const units: Record<string, { dimension: "mass" | "volume" | "count"; toBase: number; symbol: string }> = {
  g: { dimension: "mass", toBase: 1, symbol: "g" },
  kg: { dimension: "mass", toBase: 1000, symbol: "kg" },
  oz: { dimension: "mass", toBase: 28.349523125, symbol: "oz" },
  lb: { dimension: "mass", toBase: 453.59237, symbol: "lb" },
  ml: { dimension: "volume", toBase: 1, symbol: "ml" },
  l: { dimension: "volume", toBase: 1000, symbol: "L" },
  tsp: { dimension: "volume", toBase: 4.92892159375, symbol: "tsp" },
  tbsp: { dimension: "volume", toBase: 14.78676478125, symbol: "tbsp" },
  cup: { dimension: "volume", toBase: 236.5882365, symbol: "cup" },
  slice: { dimension: "count", toBase: 1, symbol: "slice" },
  clove: { dimension: "count", toBase: 1, symbol: "clove" },
};

function preferredUnit(baseValue: number, dimension: "mass" | "volume" | "count", system: "metric" | "us") {
  if (dimension === "mass") return system === "metric" ? (baseValue >= 1000 ? "kg" : "g") : (baseValue / units.oz.toBase >= 16 ? "lb" : "oz");
  if (dimension === "volume") {
    if (system === "metric") return baseValue >= 1000 ? "l" : "ml";
    return baseValue >= units.cup.toBase ? "cup" : baseValue >= units.tbsp.toBase ? "tbsp" : "tsp";
  }
  return null;
}

function formatAmount(value: number): string {
  const fractions = [[1 / 8, "1/8"], [1 / 4, "1/4"], [1 / 3, "1/3"], [1 / 2, "1/2"], [2 / 3, "2/3"], [3 / 4, "3/4"], [7 / 8, "7/8"]] as const;
  const whole = Math.floor(value + 1e-9);
  const fraction = value - whole;
  const match = fractions.find(([candidate]) => Math.abs(candidate - fraction) < .015);
  if (match) return whole ? `${whole} ${match[1]}` : match[1];
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
}

export function displayIngredientLine(
  ingredient: {
    rawLine: string;
    ingredient: string;
    quantityMin: string | null;
    quantityMax: string | null;
    unitId: string | null;
    preparation: string | null;
  },
  system: "original" | "metric" | "us",
  scale = 1,
): string {
  if (ingredient.quantityMin === null || !Number.isFinite(scale) || scale <= 0) return ingredient.rawLine;
  if (system === "original" && scale === 1) return ingredient.rawLine;
  const originalUnit = ingredient.unitId ? units[ingredient.unitId.toLowerCase()] : undefined;
  if (ingredient.unitId && !originalUnit) return ingredient.rawLine;
  let minimum = Number(ingredient.quantityMin) * scale;
  let maximum = ingredient.quantityMax === null ? null : Number(ingredient.quantityMax) * scale;
  let symbol = originalUnit?.symbol ?? "";
  if (originalUnit && system !== "original") {
    const targetId = preferredUnit(minimum * originalUnit.toBase, originalUnit.dimension, system);
    if (targetId) {
      const target = units[targetId];
      minimum = minimum * originalUnit.toBase / target.toBase;
      maximum = maximum === null ? null : maximum * originalUnit.toBase / target.toBase;
      symbol = target.symbol;
    }
  }
  if (symbol === "cup" && (minimum !== 1 || (maximum !== null && maximum !== 1))) symbol = "cups";
  if (symbol === "slice" && (minimum !== 1 || (maximum !== null && maximum !== 1))) symbol = "slices";
  if (symbol === "clove" && (minimum !== 1 || (maximum !== null && maximum !== 1))) symbol = "cloves";
  const quantity = `${formatAmount(minimum)}${maximum === null ? "" : `-${formatAmount(maximum)}`}`;
  return `${quantity}${symbol ? ` ${symbol}` : ""} ${ingredient.ingredient}${ingredient.preparation ? `, ${ingredient.preparation}` : ""}`.trim();
}

export function safeReturnTo(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/recipes";
}

export interface MealSlotDefinition {
  id: string;
  label: string;
}

export const defaultMealSlots: MealSlotDefinition[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snack" },
];

export const maximumMealSlots = 8;
const maximumLabelLength = 32;
const slotIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isMealSlotId(value: string): boolean {
  return slotIdPattern.test(value);
}

function generatedSlotId(label: string, index: number): string {
  const slug = label.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return slug || `meal-${index + 1}`;
}

export function parseMealSlotDefinitions(ids: unknown[], labels: unknown[]): MealSlotDefinition[] {
  if (!labels.length) throw new Error("At least one meal section is required");
  if (labels.length > maximumMealSlots) throw new Error(`Meal plans support up to ${maximumMealSlots} sections`);

  const usedIds = new Set<string>();
  const usedLabels = new Set<string>();
  return labels.map((value, index) => {
    const label = String(value ?? "").trim().replace(/\s+/g, " ");
    if (!label) throw new Error("Meal section names cannot be blank");
    if (label.length > maximumLabelLength) throw new Error(`Meal section names must be ${maximumLabelLength} characters or fewer`);
    const labelKey = label.toLocaleLowerCase();
    if (usedLabels.has(labelKey)) throw new Error("Meal section names must be unique");
    usedLabels.add(labelKey);

    const suppliedId = String(ids[index] ?? "");
    let id = suppliedId ? suppliedId : generatedSlotId(label, index);
    if (!isMealSlotId(id)) throw new Error("Meal section identifier is invalid");
    if (usedIds.has(id)) {
      if (suppliedId) throw new Error("Meal section identifiers must be unique");
      const base = id;
      let suffix = 2;
      while (usedIds.has(`${base}-${suffix}`)) suffix += 1;
      id = `${base}-${suffix}`;
    }
    usedIds.add(id);
    return { id, label };
  });
}

export function readStoredMealSlots(value: unknown): MealSlotDefinition[] {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    if (!Array.isArray(parsed)) return defaultMealSlots.map((slot) => ({ ...slot }));
    return parseMealSlotDefinitions(parsed.map((slot) => slot?.id), parsed.map((slot) => slot?.label));
  } catch {
    return defaultMealSlots.map((slot) => ({ ...slot }));
  }
}

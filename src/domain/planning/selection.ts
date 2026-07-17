import { startOfIsoWeek, weekDates } from "./dates";
import { isMealSlotId } from "./slots";

export interface MealPlanSelection {
  week: string;
  date: string;
  slot: string;
}

interface ParameterReader {
  get(name: string): unknown;
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function readMealPlanSelection(parameters: ParameterReader): MealPlanSelection | null {
  const requestedWeek = String(parameters.get("planWeek") ?? "");
  const date = String(parameters.get("planDate") ?? "");
  const slot = String(parameters.get("planSlot") ?? "");
  if (!isoDatePattern.test(requestedWeek) || !isoDatePattern.test(date) || !isMealSlotId(slot)) return null;

  try {
    const week = startOfIsoWeek(requestedWeek);
    if (!weekDates(week).includes(date)) return null;
    return { week, date, slot };
  } catch {
    return null;
  }
}

export function withMealPlanSelection(path: string, selection: MealPlanSelection | null): string {
  if (!selection) return path;
  const url = new URL(path, "https://tableplan.local");
  url.searchParams.set("planWeek", selection.week);
  url.searchParams.set("planDate", selection.date);
  url.searchParams.set("planSlot", selection.slot);
  return `${url.pathname}${url.search}${url.hash}`;
}

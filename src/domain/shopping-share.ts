import type { ShoppingListView } from "./shopping";

export interface ResolvedShoppingShare { id: string; listId: string; householdId: string; expiresAt: string }
export interface ShoppingShareView { id: string; tokenPrefix: string; expiresAt: string; revokedAt: string | null; lastAccessedAt: string | null; createdAt: string }
export type PublicShoppingList = Pick<ShoppingListView, "id" | "name" | "measurementSystem" | "updatedAt" | "items"> & { plan: null | { name: string; startsOn: string; endsOn: string } };
export const SHARE_EXPIRY_DAYS = [3, 7, 14, 30] as const;
export function parseShareExpiryDays(value: unknown): number {
  const days = Number(value ?? 14);
  if (!SHARE_EXPIRY_DAYS.includes(days as typeof SHARE_EXPIRY_DAYS[number])) throw new Error("Link lifetime must be 3, 7, 14, or 30 days");
  return days;
}

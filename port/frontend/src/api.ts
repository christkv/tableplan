export interface RecipeSummary {
  id: string;
  sourceId: string;
  name: string;
  description: string;
  servings: number | null;
  tags: string[];
  ingredients: string[];
  qualityFlags: string[];
  visibility: "catalog" | "user_private" | "household";
  origin: "dataset" | "manual" | "paste" | "upload";
  isOwner: boolean;
}

export interface RecipeSearchResult {
  recipes: RecipeSummary[];
  hasMore: boolean;
  total: { value: number; relation: "exact" | "lowerBound" } | null;
  limit: number;
  offset: number;
  nextCursor: string | null;
}

export interface RecipeDetail extends RecipeSummary {
  servingSize: string | null;
  steps: Array<{ position: number; instruction: string; parseStatus: string }>;
  recipeIngredients: Array<{
    id: string;
    position: number;
    rawLine: string;
    ingredient: string;
    quantityMin: string | null;
    quantityMax: string | null;
    unitId: string | null;
    preparation: string | null;
    parseStatus: string;
  }>;
}

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

export interface RecipeIngestion {
  id: string;
  status: "queued" | "extracting" | "review_ready" | "published" | "failed" | "cancelled";
  message: string;
  filename: string | null;
  mediaType: string | null;
  draft: RecipeDraft | null;
  ingredientReviews: Array<{
    position: number;
    rawLine: string;
    parsedName: string;
    ingredientId: string | null;
    mappingStatus: "mapped" | "unmapped";
    mappingConfidence: number;
    candidates: Array<{ id: string; name: string; category: string | null }>;
  }>;
  recipeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  user: { id: string; name: string; email: string; username: string };
  householdId: string;
}

export interface MealPlanItem {
  id: string;
  recipeId: string;
  recipeName: string;
  plannedDate: string;
  mealSlot: string;
  servings: number;
  notes?: string | null;
}

export interface MealPlan {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  version: number;
  items: MealPlanItem[];
}

export interface MealPlanItemContext {
  itemId: string;
  planId: string;
  planName: string;
  startsOn: string;
  endsOn: string;
  recipeId: string;
  plannedDate: string;
  mealSlot: string;
  servings: number;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantityMin: string | null;
  quantityMax: string | null;
  unitId: string | null;
  checked: boolean;
  unresolved: boolean;
  sources: Array<{ recipeId: string; recipeName: string; rawLine: string }>;
}

export interface ShoppingList {
  id: string;
  name: string;
  measurementSystem: string;
  generatedAt?: string;
  updatedAt: string;
  version: number;
  plan: { id: string; name: string; startsOn: string; endsOn: string; mealCount: number } | null;
  items: ShoppingItem[];
}

export interface ShoppingItemUpdate {
  item: ShoppingItem;
  version: number;
  updatedAt: string;
}

export interface PublicShoppingItemUpdate {
  item: ShoppingItem;
  updatedAt: string;
}

export interface Preferences {
  measurementSystem: "original" | "metric" | "us";
  appearance: "system" | "light" | "dark";
  mealSlots: Array<{ id: string; label: string }>;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  ingredient: string;
  tags: string[];
  tagMatch: "all" | "any";
  scope: string;
  createdAt: string;
  updatedAt: string;
}

export interface Household {
  id: string;
  name: string;
  timezone: string;
  currentRole: string;
  members: Array<{ userId: string; name: string; email: string; role: string; relationship: string }>;
}

export interface Invitation {
  id: string;
  householdName?: string;
  email: string;
  role: string;
  relationship: string;
  status?: string;
  deliveryStatus?: string;
  createdAt?: string;
  token?: string;
  expiresAt: string;
}

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface HouseholdChoice {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

export interface ShareView {
  id: string;
  token?: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface ShoppingOverview {
  list: ShoppingList | null;
  preferences: Preferences;
  shares: ShareView[];
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

let csrf: { headerName: string; token: string } | undefined;
const queryCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();

export function invalidateQueryCache(...prefixes: string[]) {
  if (!prefixes.length) {
    queryCache.clear();
    return;
  }
  for (const key of queryCache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) queryCache.delete(key);
  }
}

async function perform<T>(path: string, options: RequestInit, signal?: AbortSignal, retry = true): Promise<T> {
  const method = options.method?.toUpperCase() ?? "GET";
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !headers.has("Authorization")) {
    const token = csrf ?? await fetch("/api/auth/csrf", { credentials: "same-origin" }).then((response) => response.json());
    csrf = token;
    headers.set(token.headerName, token.token);
  }
  const response = await fetch(path, { ...options, credentials: "same-origin", headers, signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ code: "request_failed", message: response.statusText }));
    if (retry && response.status === 403 && body.code === "csrf_invalid") {
      csrf = undefined;
      return perform(path, options, signal, false);
    }
    throw new ApiClientError(response.status, body.code ?? "request_failed", body.message ?? response.statusText, body.requestId, body.fieldErrors);
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) invalidateQueryCache();
  if (response.status === 204 || response.headers.get("content-length") === "0") return undefined as T;
  return response.json() as Promise<T>;
}

export function request<T>(path: string, options: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  return perform(path, options, signal);
}

export function cachedRequest<T>(path: string, ttlMs = 30_000): Promise<T> {
  const current = queryCache.get(path);
  if (current && current.expiresAt > Date.now()) return current.promise as Promise<T>;
  const promise = request<T>(path).catch((error) => {
    queryCache.delete(path);
    throw error;
  });
  queryCache.set(path, { expiresAt: Date.now() + ttlMs, promise });
  return promise;
}

export const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });
export const put = (body: unknown): RequestInit => json(body, "PUT");
export const patch = (body: unknown): RequestInit => json(body, "PATCH");
export const remove = (): RequestInit => ({ method: "DELETE" });

export function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

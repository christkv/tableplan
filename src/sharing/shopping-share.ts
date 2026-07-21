import { getShoppingListById } from "../db/shopping";
import type { PublicShoppingList, ResolvedShoppingShare } from "../domain/shopping-share";
import { parseShareExpiryDays } from "../domain/shopping-share";
export { parseShareExpiryDays, SHARE_EXPIRY_DAYS, type PublicShoppingList, type ResolvedShoppingShare, type ShoppingShareView } from "../domain/shopping-share";

const encoder = new TextEncoder();
const SHARE_COOKIE = "tableplan_shopping_access";

export function randomShareToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function hashShareToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function shareTokenPrefix(token: string): string {
  return token.slice(0, 10);
}

export async function createShoppingShare(db: D1Database, input: { householdId: string; userId: string; listId: string; expiresInDays: number }) {
  const list = await db.prepare("SELECT id FROM shopping_lists WHERE id=? AND household_id=?").bind(input.listId, input.householdId).first<{ id: string }>();
  if (!list) throw new Error("Shopping list not found");
  const id = crypto.randomUUID();
  const token = randomShareToken();
  const expiresAt = new Date(Date.now() + parseShareExpiryDays(input.expiresInDays) * 86_400_000).toISOString();
  await db.prepare(`INSERT INTO shopping_list_shares
    (id, shopping_list_id, household_id, token_prefix, token_hash, created_by_user_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.listId, input.householdId, shareTokenPrefix(token), await hashShareToken(token), input.userId, expiresAt).run();
  return { id, token, expiresAt };
}

export async function resolveShoppingShare(db: D1Database, token: string, expectedShareId?: string): Promise<ResolvedShoppingShare | null> {
  if (!token || token.length > 256) return null;
  const row = await db.prepare(`SELECT id, shopping_list_id, household_id, expires_at
    FROM shopping_list_shares WHERE token_hash=? AND revoked_at IS NULL AND datetime(expires_at)>CURRENT_TIMESTAMP`)
    .bind(await hashShareToken(token)).first<{ id: string; shopping_list_id: string; household_id: string; expires_at: string }>();
  if (!row || (expectedShareId && row.id !== expectedShareId)) return null;
  return { id: row.id, listId: row.shopping_list_id, householdId: row.household_id, expiresAt: row.expires_at };
}

export async function revokeShoppingShare(db: D1Database, householdId: string, listId: string, shareId: string): Promise<boolean> {
  const result = await db.prepare(`UPDATE shopping_list_shares SET revoked_at=CURRENT_TIMESTAMP
    WHERE id=? AND shopping_list_id=? AND household_id=? AND revoked_at IS NULL`).bind(shareId, listId, householdId).run();
  return Boolean(result.meta.changes);
}

export async function listShoppingShares(db: D1Database, householdId: string, listId: string) {
  const rows = await db.prepare(`SELECT id, token_prefix, expires_at, revoked_at, last_accessed_at, created_at
    FROM shopping_list_shares WHERE household_id=? AND shopping_list_id=? ORDER BY created_at DESC LIMIT 10`)
    .bind(householdId, listId).all<{ id: string; token_prefix: string; expires_at: string; revoked_at: string | null; last_accessed_at: string | null; created_at: string }>();
  return rows.results.map((row) => ({ id: row.id, tokenPrefix: row.token_prefix, expiresAt: row.expires_at, revokedAt: row.revoked_at, lastAccessedAt: row.last_accessed_at, createdAt: row.created_at }));
}

export async function getPublicShoppingList(db: D1Database, share: ResolvedShoppingShare): Promise<PublicShoppingList | null> {
  const list = await getShoppingListById(db, share.householdId, share.listId);
  if (!list) return null;
  return {
    id: list.id,
    name: list.name,
    measurementSystem: list.measurementSystem,
    updatedAt: list.updatedAt,
    plan: list.plan ? { name: list.plan.name, startsOn: list.plan.startsOn, endsOn: list.plan.endsOn } : null,
    items: list.items.map((item) => ({ ...item, sources: [] })),
  };
}

export async function togglePublicShoppingItem(db: D1Database, share: ResolvedShoppingShare, itemId: string, checked: boolean): Promise<boolean> {
  const result = await db.prepare(`UPDATE shopping_list_items SET checked=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND shopping_list_id=?`).bind(checked ? 1 : 0, itemId, share.listId).run();
  if (result.meta.changes) await db.prepare("UPDATE shopping_lists SET updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(share.listId).run();
  return Boolean(result.meta.changes);
}

export function readShareCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SHARE_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function createShareCookie(token: string, expiresAt: string, secure: boolean): string {
  return `${SHARE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}${secure ? "; Secure" : ""}`;
}

export function clearShareCookie(secure: boolean): string {
  return `${SHARE_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function publicSecurityHeaders(): HeadersInit {
  return {
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

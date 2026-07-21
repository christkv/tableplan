export const API_SCOPES = ["recipes:read", "recipes:write", "plans:read", "plans:write", "shopping:read", "shopping:write", "household:read", "admin:import"] as const;
export type ApiScope = typeof API_SCOPES[number];
export interface ApiKeyView { id: string; name: string; prefix: string; scopes: ApiScope[]; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
export interface ApiKeyAuthentication { id: string; userId: string; householdId: string; scopes: ApiScope[] }

const encoder = new TextEncoder();
export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function randomApiToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes)); let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export function apiKeyPrefix(key: string): string { return key.slice(0, 20); }

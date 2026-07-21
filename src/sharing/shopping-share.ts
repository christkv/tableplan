export {
  parseShareExpiryDays,
  SHARE_EXPIRY_DAYS,
  type PublicShoppingList,
  type ResolvedShoppingShare,
  type ShoppingShareView,
} from "../domain/shopping-share";

const SHARE_COOKIE = "tableplan_shopping_access";

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

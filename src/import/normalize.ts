import he from "he";

export function decodeSourceText(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = he.decode(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export function stableId(prefix: string, value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${prefix}_${hash.toString(16).padStart(16, "0")}`;
}

export function normalizeIngredientName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(fresh|chopped|diced|minced|sliced|shredded|melted|cooked|optional)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTag(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, "-");
}

export function parseServings(value: string): { value: number | null; flags: string[] } {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return { value: null, flags: ["invalid_servings"] };
  return { value: parsed, flags: parsed > 50 ? ["large_servings"] : [] };
}

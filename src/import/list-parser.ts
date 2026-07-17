export interface ListParseResult {
  values: string[];
  status: "strict" | "repaired" | "failed";
  reason?: string;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return value;
}

function escapeInteriorQuotes(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (escaped) {
      output += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      output += character;
      escaped = true;
      continue;
    }
    if (character !== '"') {
      output += character;
      continue;
    }
    if (!inString) {
      inString = true;
      output += character;
      continue;
    }
    const remainder = input.slice(index + 1);
    const next = remainder.match(/^\s*(.)/)?.[1];
    if (next === "," || next === "]" || next === undefined) {
      inString = false;
      output += character;
    } else {
      output += '\\"';
    }
  }
  return output;
}

export function parseStringList(input: string): ListParseResult {
  if (!input.trim()) return { values: [], status: "strict" };
  try {
    const values = stringArray(JSON.parse(input));
    return values
      ? { values, status: "strict" }
      : { values: [], status: "failed", reason: "not_string_array" };
  } catch {
    try {
      const values = stringArray(JSON.parse(escapeInteriorQuotes(input)));
      return values
        ? { values, status: "repaired" }
        : { values: [], status: "failed", reason: "repaired_value_not_string_array" };
    } catch {
      return { values: [], status: "failed", reason: "invalid_json_array" };
    }
  }
}

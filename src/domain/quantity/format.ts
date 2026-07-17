import type { QuantityRange } from "./types";

const commonFractions = [
  [1 / 8, "1/8"],
  [1 / 4, "1/4"],
  [1 / 3, "1/3"],
  [1 / 2, "1/2"],
  [2 / 3, "2/3"],
  [3 / 4, "3/4"],
  [7 / 8, "7/8"],
] as const;

export function formatNumber(value: number): string {
  const whole = Math.floor(value + 1e-9);
  const fraction = value - whole;
  const match = commonFractions.find(([candidate]) => Math.abs(candidate - fraction) < 0.015);
  if (match) return whole > 0 ? `${whole} ${match[1]}` : match[1];
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
}

export function formatQuantity(range: QuantityRange): string {
  const min = formatNumber(range.min);
  return range.max === undefined ? min : `${min}-${formatNumber(range.max)}`;
}

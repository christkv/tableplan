import type { MeasurementSystem } from "./quantity/types";

export function parseMeasurementSystem(value: unknown): MeasurementSystem {
  if (value === "original" || value === "us" || value === "metric") return value;
  throw new Error("Measurement system must be original, metric, or US");
}

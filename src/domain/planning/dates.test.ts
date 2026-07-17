import { describe, expect, it } from "vitest";

import { addDays, parseIsoDate, startOfIsoWeek, weekDates } from "./dates";

describe("planning dates", () => {
  it("finds Monday for any date in an ISO week", () => {
    expect(startOfIsoWeek("2026-07-16")).toBe("2026-07-13");
    expect(startOfIsoWeek("2026-07-19")).toBe("2026-07-13");
  });
  it("crosses month boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(weekDates("2026-07-30")).toEqual(["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
  });
  it("rejects impossible or ambiguous dates", () => {
    expect(() => parseIsoDate("2026-02-30")).toThrow(/Invalid/);
    expect(() => parseIsoDate("07/16/2026")).toThrow(/YYYY-MM-DD/);
  });
});

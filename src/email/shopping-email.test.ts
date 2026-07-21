import { describe, expect, it } from "vitest";

import type { ShoppingListView } from "../domain/shopping";
import { renderShoppingEmail } from "./shopping-email";

describe("shopping-list email", () => {
  it("renders HTML and plain text with a live checklist link", () => {
    const list: ShoppingListView = {
      id: "list-1", name: 'Shopping & "More"', measurementSystem: "metric", generatedAt: "2026-07-17", updatedAt: "2026-07-17",
      plan: { id: "plan-1", name: "Week", startsOn: "2026-07-13", endsOn: "2026-07-19", mealCount: 2 },
      items: [{ id: "item-1", name: "Apples <ripe>", quantityMin: "2", quantityMax: null, unitId: "kg", checked: false, unresolved: false, sources: [] }],
    };
    const content = renderShoppingEmail(list, "https://example.com/shared/shopping#access=secret", "2026-07-31T00:00:00Z");
    expect(content.subject).toContain("Shopping &");
    expect(content.html).toContain("Shopping &amp; &quot;More&quot;");
    expect(content.html).toContain("Apples &lt;ripe&gt;");
    expect(content.text).toContain("[ ] Apples <ripe> - 2 kg");
    expect(content.text).toContain("#access=secret");
  });
});

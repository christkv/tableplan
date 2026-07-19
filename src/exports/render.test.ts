import { describe, expect, it } from "vitest";

import { parseExportOptions, safeExportFilename, type RecipeExportModel, type ShoppingListExportModel } from "./models";
import { escapeHtml, renderRecipeHtml, renderShoppingListHtml } from "./render";

describe("export rendering", () => {
  it("escapes user and dataset content", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    const model: RecipeExportModel = { kind: "recipe", title: 'Apple & "Pie"', description: "<b>private</b>", servings: 4, servingSize: null, measurementSystem: "metric", tags: ["dessert"], ingredients: [{ text: "500 g apples", unresolved: false }], steps: ["Bake <carefully>"] };
    const html = renderRecipeHtml(model);
    expect(html).toContain("Apple &amp; &quot;Pie&quot;");
    expect(html).not.toContain("<b>private</b>");
    expect(html).toContain("500 g apples");
  });

  it("renders durable checkbox borders and checked state", () => {
    const model: ShoppingListExportModel = { kind: "shopping-list", id: "list", title: "Weekly list", startsOn: null, endsOn: null, measurementSystem: "us", items: [{ name: "Milk", quantity: "2 cup", checked: true, unresolved: false, sources: ["Pancakes"] }] };
    const html = renderShoppingListHtml(model);
    expect(html).toContain("class=\"shopping-item checked\"");
    expect(html).toContain("class=\"checkbox\"");
    expect(html).toContain("Pancakes");
  });

  it("bounds options and sanitizes filenames", () => {
    const options = parseExportOptions(new URLSearchParams("paper=letter&measurementSystem=us&servings=8"), { measurementSystem: "metric", servings: 4 });
    expect(options).toMatchObject({ paper: "letter", measurementSystem: "us", servings: 8 });
    expect(safeExportFilename('../../Apple "Pie"')).toBe("apple-pie");
  });
});

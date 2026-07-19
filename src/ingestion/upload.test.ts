import { describe, expect, it } from "vitest";

import { recipeInputKindForMediaType, resolveRecipeUploadMediaType } from "./upload";

describe("recipe upload media types", () => {
  it("uses supported browser-reported media types", () => {
    expect(resolveRecipeUploadMediaType({ name: "recipe.bin", type: "image/webp" })).toBe("image/webp");
  });

  it("infers accepted files when browsers omit or generalize the media type", () => {
    expect(resolveRecipeUploadMediaType({ name: "family-recipe.PDF", type: "" })).toBe("application/pdf");
    expect(resolveRecipeUploadMediaType({ name: "family-recipe.docx", type: "application/octet-stream" }))
      .toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("rejects unknown file extensions and media types", () => {
    expect(resolveRecipeUploadMediaType({ name: "recipe.exe", type: "application/octet-stream" })).toBeNull();
  });

  it("classifies resolved media types by processing operation", () => {
    expect(recipeInputKindForMediaType("text/markdown")).toBe("text");
    expect(recipeInputKindForMediaType("image/png")).toBe("image");
    expect(recipeInputKindForMediaType("application/pdf")).toBe("document");
  });
});

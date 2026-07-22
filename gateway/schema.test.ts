import { describe, expect, it } from "vitest";

import { collectionDefinitions } from "./schema";

describe("MongoDB schema", () => {
  it("indexes catalog tag filters and their name ordering", () => {
    const recipes = collectionDefinitions.find((definition) => definition.name === "recipes");
    const index = recipes?.indexes.find((candidate) => candidate.name === "recipe_catalog_tags_list");

    expect(index?.key).toEqual({ visibility: 1, status: 1, tags: 1, name: 1 });
  });
});

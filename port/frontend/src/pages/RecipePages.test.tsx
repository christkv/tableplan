import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { RecipeDetailPage } from "./RecipePages";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("recipe meal-plan selection", () => {
  it("adds directly to the selected slot with plan-safe servings", async () => {
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/api/v1/recipes/recipe-large")) {
        return Response.json({
          id: "recipe-large",
          sourceId: "large",
          name: "Celebration Cake",
          description: "",
          servings: 180,
          tags: [],
          ingredients: [],
          qualityFlags: [],
          visibility: "catalog",
          origin: "dataset",
          isOwner: false,
          servingSize: null,
          steps: [],
          recipeIngredients: [],
        });
      }
      if (path.endsWith("/api/v1/preferences")) {
        return Response.json({
          measurementSystem: "original",
          mealSlots: [{ id: "dinner", label: "Dinner" }],
        });
      }
      if (path.endsWith("/api/v1/recipes/recipe-large/favourite")) {
        return Response.json({ favourite: false });
      }
      if (path.endsWith("/api/auth/csrf")) {
        return Response.json({ headerName: "X-XSRF-TOKEN", token: "csrf-token" });
      }
      if (path.endsWith("/api/v1/meal-plans") && init?.method === "POST") {
        submitted = JSON.parse(String(init.body));
        return Response.json({
          id: "plan-1",
          name: "Week",
          startsOn: "2026-07-13",
          endsOn: "2026-07-19",
          version: 1,
          items: [],
        }, { status: 201 });
      }
      return Response.json({ code: "not_found", message: path }, { status: 404 });
    }));

    render(
      <MemoryRouter initialEntries={[
        "/recipes/recipe-large?planWeek=2026-07-15&planDate=2026-07-17&planSlot=dinner",
      ]}>
        <Routes>
          <Route path="/recipes/:recipeId" element={<RecipeDetailPage />} />
          <Route path="/plan" element={<h1>Plan destination</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    const add = await screen.findByRole("button", { name: "Add to Dinner" });
    fireEvent.click(add);

    await screen.findByRole("heading", { name: "Plan destination" });
    await waitFor(() => expect(submitted).toEqual({
      week: "2026-07-13",
      recipeId: "recipe-large",
      date: "2026-07-17",
      slot: "dinner",
      servings: 100,
      notes: null,
    }));
  });
});

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { App, FRONTEND_PAGE_ROUTES } from "./App";
import { SessionProvider } from "./session";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const sourcePageRoutes = [
  "/",
  "/sign-in",
  "/auth/error",
  "/household/join",
  "/shared/shopping",
  "/shared/shopping/:shareId",
  "/recipes",
  "/recipes/new",
  "/recipes/import/:ingestionId",
  "/recipes/:recipeId/edit",
  "/recipes/:recipeId",
  "/favorites",
  "/plan",
  "/shopping",
  "/settings",
];

describe("frontend route parity", () => {
  it("owns every captured source page route", () => {
    expect([...FRONTEND_PAGE_ROUTES]).toEqual(sourcePageRoutes);
  });

  it("renders a protected route after session bootstrap", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/api/auth/session")) {
        return Response.json({
          user: { id: "user-1", name: "Test User", email: "test@example.com", username: "tester" },
          householdId: "household-1",
        });
      }
      if (path.endsWith("/api/v1/favourites")) return Response.json([]);
      return Response.json({ code: "not_found", message: "Not found" }, { status: 404 });
    }));
    render(<SessionProvider><MemoryRouter initialEntries={["/favorites"]}><App /></MemoryRouter></SessionProvider>);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Favorites" })).toBeTruthy());
    await waitFor(() => expect(screen.getByText("No favorites yet")).toBeTruthy());
  });

  it("shows sign in when the session endpoint returns an empty response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(null, { status: 200, headers: { "Content-Length": "0" } }),
    ));

    render(<SessionProvider><MemoryRouter initialEntries={["/recipes"]}><App /></MemoryRouter></SessionProvider>);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in to Tableplan" })).toBeTruthy());
  });

  it("renders the invitation error state without a credential", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(null)));
    render(<SessionProvider><MemoryRouter initialEntries={["/household/join"]}><App /></MemoryRouter></SessionProvider>);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Invitation unavailable" })).toBeTruthy());
  });
});

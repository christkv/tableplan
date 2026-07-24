import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { SessionProvider } from "../session";
import { ThemeProvider } from "../theme";
import { SettingsPage } from "./SettingsPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe("appearance settings", () => {
  it("saves and applies a manual dark-mode preference", async () => {
    let savedAppearance = "";
    const stored = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => stored.clear(),
        getItem: (key: string) => stored.get(key) ?? null,
        key: (index: number) => [...stored.keys()][index] ?? null,
        get length() { return stored.size; },
        removeItem: (key: string) => stored.delete(key),
        setItem: (key: string, value: string) => stored.set(key, value),
      } satisfies Storage,
    });
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/api/auth/session")) {
        return Response.json({
          user: { id: "user-1", name: "Test User", email: "test@example.com", username: "tester", emailVerified: true },
          householdId: "household-1",
        });
      }
      if (path.endsWith("/api/v1/preferences/appearance") && init?.method === "PUT") {
        savedAppearance = String(JSON.parse(String(init.body)).appearance);
        return Response.json({
          appearance: savedAppearance,
          measurementSystem: "metric",
          mealSlots: [{ id: "dinner", label: "Dinner" }],
        });
      }
      if (path.endsWith("/api/v1/preferences")) {
        return Response.json({
          appearance: "system",
          measurementSystem: "metric",
          mealSlots: [{ id: "dinner", label: "Dinner" }],
        });
      }
      if (path.endsWith("/api/v1/household/invitations")) return Response.json([]);
      if (path.endsWith("/api/v1/households")) return Response.json([]);
      if (path.endsWith("/api/v1/api-keys")) return Response.json([]);
      if (path.endsWith("/api/v1/household")) {
        return Response.json({
          id: "household-1",
          name: "Test household",
          timezone: "Europe/Madrid",
          currentRole: "owner",
          members: [{
            userId: "user-1",
            name: "Test User",
            email: "test@example.com",
            role: "owner",
            relationship: "self",
          }],
        });
      }
      return Response.json({ code: "not_found", message: "Not found" }, { status: 404 });
    }));

    render(
      <SessionProvider>
        <ThemeProvider>
          <MemoryRouter>
            <SettingsPage />
          </MemoryRouter>
        </ThemeProvider>
      </SessionProvider>,
    );

    fireEvent.click(await screen.findByRole("radio", { name: /Dark/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));

    await waitFor(() => expect(savedAppearance).toBe("dark"));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(screen.getByText("Appearance preference saved.")).toBeTruthy();
  });
});

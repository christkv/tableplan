import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { SignInPage } from "./AuthPages";
import { SessionProvider } from "../session";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Google sign-in", () => {
  it("keeps OAuth on the frontend origin so Vite can proxy the callback and cookie", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    render(
      <SessionProvider>
        <MemoryRouter initialEntries={["/sign-in?returnTo=%2Frecipes"]}>
          <SignInPage />
        </MemoryRouter>
      </SessionProvider>,
    );

    const link = screen.getByRole("link", { name: "Continue with Google" });
    const href = link.getAttribute("href") ?? "";
    expect(href).toMatch(/^\/oauth2\/authorization\/google\?/);
    expect(href).toContain("returnTo=%2Frecipes");
    expect(href).not.toContain(":9090");
    expect(href).not.toContain("return_origin");
  });
});
